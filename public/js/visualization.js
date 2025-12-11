let ORG = "SBP";
let STEM = ORG;

let user
let services
let currentService
let serviceDraft = null
const phases = ["conception", "development", "execution", "completion"]
const categories = ['ethics submission', 'regulatory and contracts', 'statistics and feasibility', 'PPI', 'study design', 'project management', 'monitoring and audit']
const outputs = ['consulting', 'datasets', 'IT infrastructure', 'IT tool', 'outsourced service', 'standards', 'templates', 'training']
const researches = ['clinical trials', 'data collection', 'data reuse', 'sample collection', 'sample reuse']
const rankingDiv = d3.select("#ranking")

// --- AUTHENTICATION HANDLING ---

document.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('login-button');
    const loginMessage = document.getElementById('login-message');
    const loginFormContainer = document.getElementById('login-form');
    const filtersColumn = document.getElementById('filters-column');
    const headerUser = document.getElementById('header-user');
    const headerLogout = document.getElementById('header-logout');

    async function checkSession() {
        try {
            const res = await fetch('/api/me', {
                method: 'GET',
                credentials: 'include'
            });

            const data = await res.json();

            if (!data.authenticated || !data.user) {
                // No valid session → stay on login form
                loginFormContainer.style.display = 'block';
                filtersColumn.style.display = 'none';
                if (headerUser) headerUser.textContent = 'Not logged in';
                if (headerLogout) headerLogout.style.display = 'none';

                return;
            }

            // Restore user from session
            user = data.user;
            window.currentUser = data.user;
            if (headerUser) headerUser.textContent = `${user.email}, ${user.organizationCode}`;
                if (headerLogout) headerLogout.style.display = 'block';

            // Set organization context from logged-in user
            if (user.organizationCode) {
                ORG = user.organizationCode;
                if (user.organization && user.organization.idPrefix) {
                    STEM = user.organization.idPrefix;
                } else {
                    STEM = user.organizationCode;
                }
            }

            // Hide login, show admin UI
            loginFormContainer.style.display = 'none';
            filtersColumn.style.display = 'block';

            // Load services for this user/org
            if (typeof loadServices === 'function') {
                loadServices();
            }
        } catch (err) {
            console.error('Failed to restore session:', err);
            // In case of error, fall back to login
            loginFormContainer.style.display = 'block';
            filtersColumn.style.display = 'none';
        }
    }

    // Hide admin UI until logged in
    filtersColumn.style.display = 'none';

    // Allow pressing Enter to submit login
    const loginUsernameInput = document.getElementById('login-username');
    const loginPasswordInput = document.getElementById('login-password');

    function tryLoginOnEnter(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            loginButton.click(); // trigger the same login as the button
        }
    }

    loginUsernameInput.addEventListener('keydown', tryLoginOnEnter);
    loginPasswordInput.addEventListener('keydown', tryLoginOnEnter);

    loginButton.addEventListener('click', async () => {
        // Disable button for feedback and to prevent double-clicks
        loginButton.disabled = true;
        const originalLoginText = loginButton.textContent;
        loginButton.textContent = 'Logging in…';
        loginButton.classList.add('loading');

        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        loginMessage.textContent = '';

        if (!username || !password) {
            loginMessage.textContent = 'Please enter your email and password.';
            loginMessage.style.color = 'red';
            loginButton.disabled = false;
            loginButton.textContent = originalLoginText;
            loginButton.classList.remove('loading');
            return;
        }

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();

            user = data.user

            if (!res.ok || !data.success) {
                loginMessage.textContent = data.error || 'Invalid credentials.';
                loginMessage.style.color = 'red';
                loginButton.disabled = false;
                loginButton.textContent = originalLoginText;
                loginButton.classList.remove('loading');
                return;
            }

            // Success!
            loginMessage.textContent = 'Login successful.';
            loginMessage.style.color = 'green';

            // Hide the login form and show the admin UI
            loginFormContainer.style.display = 'none';
            filtersColumn.style.display = 'block';

            // Optionally keep current user in memory
            window.currentUser = data.user;
            if (headerUser) headerUser.textContent = `${user.email} (${user.organizationCode})`;
                if (headerLogout) headerLogout.style.display = 'block';

            // Set organization context from logged-in user
            if (user && user.organizationCode) {
                ORG = user.organizationCode;
                // Prefer idPrefix if present, otherwise fall back to org code
                if (user.organization && user.organization.idPrefix) {
                    STEM = user.organization.idPrefix;
                } else {
                    STEM = user.organizationCode;
                }
            }

            // Now load the services for the admin UI
            if (typeof loadServices === 'function') {
                loadServices();
            }

        } catch (err) {
            console.error('Login failed:', err);
            loginMessage.textContent = 'Server error. Please try again.';
            loginMessage.style.color = 'red';
            loginButton.disabled = false;
            loginButton.textContent = originalLoginText;
            loginButton.classList.remove('loading');
        }
    });
    // On page load, try to restore existing session from cookie
    checkSession();
});

async function logout() {
    try {
        const res = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });

        const data = await res.json();

        if (data.success) {
            console.log("Logged out.");

            // Clear local user state
            user = null;
            window.currentUser = null;
            const headerUser = document.getElementById('header-user');
            if (headerUser) {
                headerUser.textContent = 'Not logged in';
            }

            // Reset org context to default
            ORG = "SBP";
            STEM = ORG;

            // Hide admin UI
            document.getElementById('filters-column').style.display = 'none';

            // Show login form
            document.getElementById('login-form').style.display = 'block';

            // Reset login UI state
            const loginMessage = document.getElementById('login-message');
            if (loginMessage) {
                loginMessage.textContent = '';
                loginMessage.style.color = '';
            }
            const loginUsernameInput = document.getElementById('login-username');
            const loginPasswordInput = document.getElementById('login-password');
            if (loginUsernameInput) loginUsernameInput.value = '';
            if (loginPasswordInput) loginPasswordInput.value = '';

            // Re-enable and visually reset the login button
            const loginButton = document.getElementById('login-button');
            if (loginButton) {
                loginButton.disabled = false;
                loginButton.textContent = 'Login';
                loginButton.classList.remove('loading');
            }
        } else {
            console.warn("Logout failed:", data.error);
        }
    } catch (err) {
        console.error("Logout error:", err);
    }
}


async function loadServices() {
    fetch("/api/services?t=" + Date.now(), {
        cache: "no-store",
        method: "GET",
        headers: {
            "Content-type": "application/json; charset=UTF-8"
        }
    })
        .then((response) => response.json())
        .then((json) => {
            let fetched = json.services || [];

            // If a user is logged in and is not superadmin, restrict services to their organization
            if (user && !user.isSuperAdmin && user.organizationCode) {
                fetched = fetched.filter(s => s.organizationCode === user.organizationCode);
            }

            services = fetched;

            d3.select("#service-export").style("display", "inherit")
            d3.select("#service-create").style("display", "inherit")

            services.sort(function (a, b) {
                if (a.id < b.id) {
                    return -1;
                }
                if (a.id > b.id) {
                    return 1;
                }
                return 0;
            });
            console.log("Services", services)
            update()
        })
}

function getNewID() {
    let num = 1
    let id = STEM + "-" + ("0" + num).slice(-2)
    let serviceIds = services.map(service => service.id)
    while (serviceIds.includes(id)) {
        num++
        id = STEM + "-" + ("0" + num).slice(-2)
    }
    return id
}

// Mettre à jour les résultats
function update() {
    //Requests selector
    d3.select("#services").html("")
    d3.select("#services").append("option").attr("value", "").attr("disabled", true).attr("hidden", true).property("selected", true).text("Select service")
    console.log("User", user)
    services.forEach(service => {
        let name = service.id + ": " + service.name
        let length = 50
        if (name.length > length) {
            name = name.substring(0, length - 1) + "…"
        }
        d3.select("#services").append("option").attr("value", service.id).property("selected", currentService?.id == service.id)
            .text(name)
    })
    d3.select("#services").on("change", e => {
        serviceSelect(e.target.value)
    })

    if (currentService) serviceSelect(currentService.id)

}

async function updateService() {

    d3.select("#message").html("Uploading changes...")
    let text = d3.select("#service-description").html()
    text = stripHtml(text)
    if (currentService) {

        let serviceOutput = []
        outputs.forEach((output, i) => {
            if (d3.select("#cbo" + i).property("checked")) serviceOutput.push(output)
        })
        let serviceResearch = []
        researches.forEach((research, i) => {
            if (d3.select("#cbr" + i).property("checked")) serviceResearch.push(research)
        })
        let servicePhase = []
        phases.forEach((phase, i) => {
            if (d3.select("#cbp" + i).property("checked")) servicePhase.push(phase)
        })
        let serviceCategory = []
        categories.forEach((category, i) => {
            if (d3.select("#cbc" + i).property("checked")) serviceCategory.push(category)
        })

        let uri = 'update-service'
        if (serviceDraft && currentService.id == serviceDraft.id) {
            uri = 'create-service'
        }

        await fetch(`/api/${uri}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // IMPORTANT: send cookies
            body: JSON.stringify({
                id: currentService.id,
                active: d3.select("#service-active").node().checked,
                name: d3.select("#service-name").html(),
                organization: ORG,
                regional: d3.select("#service-regional").text().split(",").map(d => d.trim()).filter(d => d.length),
                research: serviceResearch,
                phase: servicePhase,
                category: serviceCategory,
                output: serviceOutput,
                hidden: d3.select("#service-hidden").html(),
                description: text,
                complement: d3.select("#service-complement").html(),
                contact: getLinesFromEditablePre(d3.select("#service-contacts").node()),
                url: getLinesFromEditablePre(d3.select("#service-urls").node()),
                docs: getLinesFromEditablePre(d3.select("#service-docs").node())
            })
        }).then((response) => response.json())
            .then(async json => {
                console.log(json)
                serviceDraft = null
                d3.select("#message").html(json.message)
                await loadServices()
            })
    }
}

function newService() {
    if (serviceDraft) {
        const index = d3.select("#new-service-option").node().index
        d3.select("#services").node().selectedIndex = index
        serviceSelect(serviceDraft.id)
    } else {
        service = {
            id: getNewID(),
            name: "My new service",
            organization: ORG,
            regional: [],
            research: [],
            phase: [],
            category: [],
            output: [],
            hidden: "",
            description: "",
            complement: "",
            contact: [],
            url: [],
            docs: [],
            active: false
        }
        services.push(service)
        serviceDraft = service
        currentService = service
        d3.select("#service").style("display", "inherit")
        d3.select("#services").append("option").attr("id", "new-service-option").attr("value", service.id).property("selected", true).text(service.id + ": " + service.name + " (draft)")
        displayService(service)
    }
}

function getLinesFromEditablePre(preEl) {
    const html = preEl.innerHTML
    const withNewlines = html
        .replace(/<div>/gi, '\n')
        .replace(/<\/div>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n');
    const tmp = document.createElement('div')
    tmp.innerHTML = withNewlines;
    let text = tmp.textContent || ''
    text = text.replace(/\r\n?|\u2028|\u2029/g, '\n');
    let lines = text.split('\n')
    lines = lines.map(l => l.trim()).filter(l => l.length)
    return lines
}


function revertService() {
    update()
}

function serviceSelect(id) {
    if (id != currentService?.id) d3.select("#message").html("")
    d3.select("#service").style("display", "inherit")
    currentService = services.find(service => service.id == id)
    console.log("Service selected", currentService)
    displayService(currentService)
}

function displayService(service) {

    d3.select("#service-update").text("Update service")
    if (serviceDraft && serviceDraft.id == service.id)
        d3.select("#service-update").text("Save service")

    d3.select("#service-active").node().checked = service.active
    d3.select("#service-name").html(service.name)
    d3.select("#service-organization").html(service.organization)
    d3.select("#service-regional").html(Array.isArray(service.regional) ? service.regional.join(", ") : (currentService.regional || ""))
    d3.select("#service-hidden").html(service?.hidden ? service.hidden : "")
    d3.select("#service-description").html(service.description)
    d3.select("#service-complement").html(service?.complement ? service.complement : "")

    d3.select("#service-contacts").html("")
    d3.select("#service-urls").html("")
    d3.select("#service-docs").html("")

    if (service?.contact) {
        service.contact.forEach((item, i) => {
            const pre = d3.select("#service-contacts")
            if (i == 0) pre.text(item)
            else pre.append("div").text(item)
        })
    }


    if (service?.url) {
        service.url.forEach((item, i) => {
            const pre = d3.select("#service-urls")
            if (i == 0) pre.text(item)
            else pre.append("div").text(item)
        })
    }

    if (service?.docs) {
        service.docs.forEach((item, i) => {
            const pre = d3.select("#service-docs")
            if (i == 0) pre.text(item)
            else pre.append("div").text(item)
        })
    }

    const outputDiv = d3.select("#service-output").html("")
    outputs.forEach((output, i) => {
        const hasOutput = Array.isArray(service?.output) && service.output.includes(output)
        outputDiv.append("input").attr("type", "checkbox").attr("name", "cbo" + i).attr("id", "cbo" + i).property("checked", hasOutput)
        outputDiv.append("label").attr("for", "cbo" + i).text(output)
    })

    const researchDiv = d3.select("#service-research").html("")
    researches.forEach((research, i) => {
        const hasResearch = Array.isArray(service?.research) && service.research.includes(research)
        researchDiv.append("input").attr("type", "checkbox").attr("name", "cbr" + i).attr("id", "cbr" + i).property("checked", hasResearch)
        researchDiv.append("label").attr("for", "cbr" + i).text(research)
    })

    const phaseDiv = d3.select("#service-phase").html("")
    phases.forEach((phase, i) => {
        const hasPhase = Array.isArray(service?.phase) && service.phase.find(p => p.toLowerCase() == phase.toLowerCase())
        phaseDiv.append("input").attr("type", "checkbox").attr("name", "cbp" + i).attr("id", "cbp" + i).property("checked", hasPhase)
        phaseDiv.append("label").attr("for", "cbp" + i).text(phase)
    })

    const categoryDiv = d3.select("#service-category").html("")
    categories.forEach((category, i) => {
        const hasCategory = Array.isArray(service?.category) && service.category.includes(category)
        categoryDiv.append("input").attr("type", "checkbox").attr("name", "cbc" + i).attr("id", "cbc" + i).property("checked", hasCategory)
        categoryDiv.append("label").attr("for", "cbc" + i).text(category == "project management" ? category + " (including data, sample, participant management)" : category)
    })
}


function exportServices() {
    if (services) {
        let rows = [["ID", "Name", "Organization", "Regional infrastructures", "Hidden description", "Description", "Complementary description", "Research", "Output", "Contact", "Links", "Documents"]];
        services.forEach(service => {
            const escapeCsv = (str) => `"${String(str).replace(/"/g, '""')}"`;
            rows.push([
                service.id,
                escapeCsv(service.name),
                escapeCsv(service.organization),
                escapeCsv(service.regional.join(";")),
                escapeCsv(service.hidden ? service.hidden : ""),
                escapeCsv(service.description),
                escapeCsv(service.complement ? service.complement : ""),
                escapeCsv(service.research.join(";")),
                escapeCsv(service.output.join(";")),
                escapeCsv(service.contact.join(";")),
                escapeCsv(service.url.join(";")),
                escapeCsv(service.docs.join(";"))
            ]);
        });

        let csvContent = rows.map(r => r.join(",")).join("\r\n");
        let blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        let url = URL.createObjectURL(blob);


        let link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", "CPCR services " + getTime() + ".csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function getTime() {
    const d = new Date();
    const datetime = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) + " at "
        + ("0" + d.getHours()).slice(-2) + "." + ("0" + d.getMinutes()).slice(-2) + "." + ("0" + d.getSeconds()).slice(-2)
    return datetime
}

function stripHtml(html) {
    let tmp = document.createElement("DIV");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
}

jQuery(function ($) {
    $("[contenteditable]").focusout(function () {
        var element = $(this);
        if (!element.text().trim().length) {
            element.empty();
        }
    });
});

d3.select("#services").append("option").attr("value", "").property("selected", true).text("Loading...")
d3.select("#service-update").on("click", updateService)
d3.select("#service-revert").on("click", revertService)
d3.select("#service-create").on("click", newService)
d3.select("#service-export").on("click", exportServices)
d3.select("#header-logout").on("click", logout)