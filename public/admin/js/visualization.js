let ORG = "SBP";
let STEM = ORG;

let me
let services
let organizations
let users
let currentService
let currentOrganization
let currentUser
let serviceDraft = null
let organizationDraft = null
let userDraft = null
const phases = ["conception", "development", "execution", "completion"]
const categories = ['ethics submission', 'regulatory and contracts', 'statistics and feasibility', 'PPI', 'study design', 'project management', 'quality, monitoring and audit']
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
    const organizationPanel = document.getElementById('organization-panel');
    const userPanel = document.getElementById('user-panel');
    const adminTabs = document.getElementById('admin-tabs');

    // --- Force password change overlay (shown when user.forcePasswordChange === true) ---

    // Ensure the correct admin UI is shown based on authentication/role
    function applyAdminVisibility(user) {
        const servicePanel = document.getElementById('service-panel');
        const orgPanel = document.getElementById('organization-panel');
        const usrPanel = document.getElementById('user-panel');

        // Tabs: only superadmins can see and use them
        if (adminTabs) {
            adminTabs.style.display = (user && user.isSuperAdmin) ? 'flex' : 'none';
        }

        // Panels: regular admins should only see service management
        if (orgPanel) orgPanel.style.display = (user && user.isSuperAdmin) ? 'inherit' : 'none';
        if (usrPanel) usrPanel.style.display = (user && user.isSuperAdmin) ? 'inherit' : 'none';
        if (servicePanel) servicePanel.style.display = 'inherit';

        // Also enforce the active tab/panel CSS state
        const tabs = Array.from(document.querySelectorAll('.admin-tab'));
        const panels = Array.from(document.querySelectorAll('.admin-section'));

        if (user && user.isSuperAdmin) {
            // Leave existing tab logic to decide which panel is active (hash-based).
            return;
        }

        // Non-superadmins: force service panel active
        tabs.forEach(t => t.classList.remove('is-active'));
        panels.forEach(p => p.classList.remove('is-active'));

        const servicePanelEl = document.getElementById('service-panel');
        const serviceTabBtn = document.querySelector('.admin-tab[data-tab="service-panel"]');
        if (serviceTabBtn) serviceTabBtn.classList.add('is-active');
        if (servicePanelEl) servicePanelEl.classList.add('is-active');

        // Keep URL hash consistent
        if (location.hash !== '#service-panel') {
            history.replaceState(null, '', '#service-panel');
        }
    }
    function showForcePasswordChangeOverlay() {
        // Avoid duplicates
        if (document.getElementById('force-password-overlay')) return;

        const overlay = document.createElement('div');
        overlay.id = 'force-password-overlay';
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0, 0, 0, 0.65)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '9999';

        overlay.innerHTML = `
            <div style="background:#fff; padding:22px; border-radius:12px; max-width:460px; width:92%; box-shadow:0 10px 30px rgba(0,0,0,0.25);">
                <h2 style="margin:0 0 8px 0; font-size:20px;">Change your password</h2>
                <p style="margin:0 0 16px 0; line-height:1.4;">For security reasons, you must set a new password before continuing.</p>

                <label style="display:block; font-weight:600; margin:12px 0 6px 0;">New password (min 8 chars)</label>
                <input id="pw-new" type="password" autocomplete="new-password" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:8px;" />

                <label style="display:block; font-weight:600; margin:12px 0 6px 0;">Confirm new password</label>
                <input id="pw-confirm" type="password" autocomplete="new-password" style="width:100%; padding:10px; border:1px solid #ccc; border-radius:8px;" />

                <div id="pw-error" style="color:#b00020; margin:12px 0 10px 0; min-height:18px;"></div>

                <button id="pw-save" style="width:100%; padding:10px 12px; border:0; border-radius:10px; cursor:pointer; font-weight:700;">Save new password</button>

                <p style="margin:12px 0 0 0; font-size:12px; opacity:0.8;"></p>
            </div>
        `;

        document.body.appendChild(overlay);

        const newEl = document.getElementById('pw-new');
        const confirmEl = document.getElementById('pw-confirm');
        const saveBtn = document.getElementById('pw-save');
        const errEl = document.getElementById('pw-error');

        const submit = async () => {
            errEl.textContent = '';

            const newPassword = newEl.value;
            const confirm = confirmEl.value;

            if (!newPassword || !confirm) {
                errEl.textContent = 'Please fill all fields.';
                return;
            }
            if (String(newPassword).length < 8) {
                errEl.textContent = 'New password must be at least 8 characters.';
                return;
            }
            if (newPassword !== confirm) {
                errEl.textContent = 'New password and confirmation do not match.';
                return;
            }

            // UI feedback
            saveBtn.disabled = true;
            const originalText = saveBtn.textContent;
            saveBtn.textContent = 'Saving…';

            try {
                const res = await fetch('/api/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ newPassword })
                });

                let data = null;
                try {
                    data = await res.json();
                } catch (_) {
                    data = null;
                }

                if (!res.ok || !data || !data.success) {
                    errEl.textContent = (data && (data.error || data.detail)) ? (data.error || data.detail) : 'Could not change password.';
                    saveBtn.disabled = false;
                    saveBtn.textContent = originalText;
                    return;
                }

                // Success: update local state and continue
                if (me) me.forcePasswordChange = false;
                if (window.currentUser) window.currentUser.forcePasswordChange = false;

                overlay.remove();

                // Ensure admin UI is visible
                loginFormContainer.style.display = 'none';
                filtersColumn.style.display = 'inherit';

                // Restore org panel visibility for superadmins
                if (organizationPanel) {
                    organizationPanel.style.display = (me && me.isSuperAdmin) ? 'inherit' : 'none';
                }
                // Restore user panel visibility for superadmins
                if (userPanel) {
                    userPanel.style.display = (me && me.isSuperAdmin) ? 'inherit' : 'none';
                }
                applyAdminVisibility(me);


                // Load data now that password has been updated
                if (typeof loadServices === 'function') {
                    loadServices();
                }
                if (me && me.isSuperAdmin && typeof loadOrganizations === 'function' && typeof loadUsers === 'function') {
                    loadOrganizations();
                }
            } catch (e) {
                console.error('Password change failed:', e);
                errEl.textContent = 'Server error. Please try again.';
                saveBtn.disabled = false;
                saveBtn.textContent = originalText;
            }
        };

        // Submit on click
        saveBtn.addEventListener('click', submit);

        // Submit on Enter for any field
        const onEnter = (ev) => {
            if (ev.key === 'Enter') {
                ev.preventDefault();
                submit();
            }
        };
        newEl.addEventListener('keydown', onEnter);
        confirmEl.addEventListener('keydown', onEnter);

        // Focus the new password field
        setTimeout(() => newEl.focus(), 0);
    }

    async function checkSession() {
        try {
            const res = await fetch('/api/me', {
                method: 'GET',
                credentials: 'include'
            });

            const data = await res.json();

            if (!data.authenticated || !data.user) {
                // No valid session → stay on login form
                loginFormContainer.style.display = 'inherit';
                filtersColumn.style.display = 'none';
                if (headerUser) headerUser.textContent = 'Not logged in';
                if (headerLogout) headerLogout.style.display = 'none';
                if (organizationPanel) organizationPanel.style.display = 'none';
                if (userPanel) userPanel.style.display = 'none';
                if (adminTabs) adminTabs.style.display = 'none';
                return;
            }

            // Restore user from session
            me = data.user;
            window.currentUser = data.user;
            if (headerUser) headerUser.textContent = `${me.email}, ${me.organizationCode}`;
            if (headerLogout) headerLogout.style.display = 'inherit';

            // Show organization panel only for superadmins
            if (organizationPanel) {
                organizationPanel.style.display = me.isSuperAdmin ? 'inherit' : 'none';
            }
            // Show user panel only for superadmins
            if (userPanel) {
                userPanel.style.display = me.isSuperAdmin ? 'inherit' : 'none';
            }
            applyAdminVisibility(me);

            // Set organization context from logged-in user (needed even if password change is forced)
            if (me.organizationCode) {
                currentOrganization = me.organization;
                ORG = me.organizationCode;
                if (me.organization && me.organization.idPrefix) {
                    STEM = me.organization.idPrefix;
                } else {
                    STEM = me.organizationCode;
                }
            }

            // If this account must change password, block access until done
            if (me.forcePasswordChange) {
                // Hide admin UI while forcing password change
                loginFormContainer.style.display = 'none';
                filtersColumn.style.display = 'none';
                if (organizationPanel) organizationPanel.style.display = 'none';
                if (userPanel) userPanel.style.display = 'none';
                if (adminTabs) adminTabs.style.display = 'none';
                showForcePasswordChangeOverlay();
                return;
            }

            // Hide login, show admin UI
            loginFormContainer.style.display = 'none';
            filtersColumn.style.display = 'inherit';

            // Load services for this user/org
            if (typeof loadServices === 'function') {
                loadServices();
            }
            if (me && me.isSuperAdmin && typeof loadOrganizations === 'function' && typeof loadUsers === 'function') {
                loadOrganizations();
            }
        } catch (err) {
            console.error('Failed to restore session:', err);
            // In case of error, fall back to login
            loginFormContainer.style.display = 'inherit';
            filtersColumn.style.display = 'none';
        }
    }

    // Hide admin UI until logged in
    filtersColumn.style.display = 'none';
    // Hide organization panel by default; only superadmins can see it
    if (organizationPanel) organizationPanel.style.display = 'none';
    // Hide user panel by default; only superadmins can see it
    if (userPanel) userPanel.style.display = 'none';
    // Hide admin tabs by default; only superadmins can see them
    if (adminTabs) adminTabs.style.display = 'none';

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

            me = data.user

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
            filtersColumn.style.display = 'inherit';

            // Optionally keep current user in memoline 377ry
            window.currentUser = data.user;
            if (headerUser) headerUser.textContent = `${me.email} (${me.organizationCode})`;
            if (headerLogout) headerLogout.style.display = 'inherit';

            // Show organization panel only for superadmins
            if (organizationPanel) {
                organizationPanel.style.display = me.isSuperAdmin ? 'inherit' : 'none';
            }
            // Show user panel only for superadmins
            if (userPanel) {
                userPanel.style.display = me.isSuperAdmin ? 'inherit' : 'none';
            }
            applyAdminVisibility(me);

            // Set organization context from logged-in user (needed even if password change is forced)
            if (me && me.organizationCode) {
                currentOrganization = me.organization;
                ORG = me.organizationCode;
                // Prefer idPrefix if present, otherwise fall back to org code
                if (me.organization && me.organization.idPrefix) {
                    STEM = me.organization.idPrefix;
                } else {
                    STEM = me.organizationCode;
                }
            }

            // If this account must change password, block access until done
            if (me && me.forcePasswordChange) {
                // Hide admin UI while forcing password change
                loginFormContainer.style.display = 'none';
                filtersColumn.style.display = 'none';
                if (organizationPanel) organizationPanel.style.display = 'none';
                if (userPanel) userPanel.style.display = 'none';
                if (adminTabs) adminTabs.style.display = 'none';
                showForcePasswordChangeOverlay();
                // Re-enable login button for future attempts (overlay handles next step)
                loginButton.disabled = false;
                loginButton.textContent = originalLoginText;
                loginButton.classList.remove('loading');
                return;
            }

            // Now load the services for the admin UI
            if (typeof loadServices === 'function') {
                loadServices();
            }

            if (me && me.isSuperAdmin && typeof loadOrganizations === 'function' && typeof loadUsers === 'function') {
                loadOrganizations();
            }

            // Restore login button state (in case UI remains visible later)
            loginButton.disabled = false;
            loginButton.textContent = originalLoginText;
            loginButton.classList.remove('loading');

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
            //console.log("Logged out.");

            // Clear local user state
            me = null;
            window.currentUser = null;
            const headerUser = document.getElementById('header-user');
            if (headerUser) {
                headerUser.textContent = 'Not logged in';
            }

            // Reset org context to default
            ORG = null;
            STEM = null;

            // Hide admin UI
            document.getElementById('filters-column').style.display = 'none';
            const organizationPanel = document.getElementById('organization-panel');
            if (organizationPanel) organizationPanel.style.display = 'none';
            const userPanel = document.getElementById('user-panel');
            if (userPanel) userPanel.style.display = 'none';
            const adminTabs = document.getElementById('admin-tabs');
            if (adminTabs) adminTabs.style.display = 'none';
            const overlay = document.getElementById('force-password-overlay');
            if (overlay) overlay.remove();

            // Show login form
            document.getElementById('login-form').style.display = 'inherit';

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
            if (me && me.organizationCode && !me.isSuperAdmin) {
                const orgCode = me.organizationCode;
                fetched = fetched.filter(s => s.organizationCode === orgCode);
            } else {
                //console.log("current organisation", currentOrganization)
                const orgCode = currentOrganization.code;
                fetched = fetched.filter(s => s.organizationCode === orgCode);
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
            //console.log("Services", services)
            enterServices()
        })
}


async function loadOrganizations() {
    fetch("/api/organizations", {
        cache: "no-store",
        method: "GET",
        headers: {
            "Content-type": "application/json; charset=UTF-8"
        }
    })
        .then((response) => response.json())
        .then((json) => {
            let fetched = json.organizations || [];
            organizations = fetched

            d3.select("#organization-create").style("display", "inherit")

            //console.log("Organizations", organizations)
            enterOrganizations()
            loadUsers();
        })
}

async function loadUsers() {
    fetch("/api/users", {
        cache: "no-store",
        method: "GET",
        headers: {
            "Content-type": "application/json; charset=UTF-8"
        }
    })
        .then((response) => response.json())
        .then((json) => {
            let fetched = json.users || [];
            users = fetched

            d3.select("#user-create").style("display", "inherit")

            //console.log("Users", users)
            enterUsers()
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
function enterServices() {
    //Requests selector
    d3.select("#services").html("")
    //d3.select("#services").append("option").attr("value", "").attr("disabled", true).attr("hidden", true).property("selected", true).text("Select service")
    //console.log("User", me)
    services//.filter(service => service.organizationCode == ORG)
    .forEach(service => {
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
    else serviceSelect()
}

async function updateService() {

    d3.select("#service-message").html("Uploading changes...")
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
                organizationCode: ORG,
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
                //console.log(json)
                serviceDraft = null
                d3.select("#service-message").html(json.message)
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

function serviceSelect(id = null) {
    //console.log("current service", currentService)
    //if (id != currentService?.id) d3.select("#service-message").html("")
    d3.select("#service").style("display", "inherit")
    if (id) currentService = services.find(service => service.id == id)
    else currentService = services[0]
    //console.log("service id", id)
    //console.log("Services 0", services[0])
    //console.log("Service selected", currentService)
    if (!services[0]) newService()
    else displayService(currentService)
}

function displayService(service) {

    d3.select("#service-update").text("Update service")
    if (serviceDraft && serviceDraft.id == service.id)
        d3.select("#service-update").text("Save service")

    d3.select("#service-active").node().checked = service?.active
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

function enterOrganizations() {
    //Requests selector
    d3.select("#organizations").html("")
    //console.log("User", me)
    organizations.forEach(organization => {
        let label = organization.fullName + (organization.fullName != organization.label ? " (" + organization.label + ")" : "")
        let length = 50
        if (label.length > length) {
            label = label.substring(0, length - 1) + "…"
        }
        d3.select("#organizations").append("option").attr("value", organization.code).property("selected", currentOrganization?.code == organization.code)
            .text(label)
    })
    d3.select("#organizations").on("change", e => {
        organizationSelect(e.target.value)
    })
    //console.log("current organization", currentOrganization)
    if (currentOrganization) organizationSelect(currentOrganization.code)
}

async function organizationSelect(code) {
    //if (code != currentOrganization?.code) d3.select("#organization-message").html("")
    d3.select("#organization").style("display", "inherit")
    currentOrganization = organizations.find(organization => organization.code == code)
    ORG = currentOrganization.code
    STEM = currentOrganization.idPrefix
    currentService = null
    serviceDraft = null
    //console.log("Organization selected", currentOrganization)
    displayOrganization(currentOrganization)
    await loadServices()
}

function displayOrganization(organization) {

    d3.select("#organization-update").text("Update organization")
    if (organizationDraft && organizationDraft.code == organization.code)
        d3.select("#organization-update").text("Save organization")

    d3.select("#organization-code").html(organization.code)
    d3.select("#organization-label").html(organization.label)
    d3.select("#organization-full-name").html(organization.fullName)
    d3.select("#organization-id-prefix").html(organization.idPrefix)
}

async function updateOrganization() {

    d3.select("#organization-message").html("Uploading changes...")
    if (currentOrganization) {

        let uri = 'update-organization'
        if (organizationDraft && currentOrganization.code == organizationDraft.code) {
            uri = 'create-organization'
        }

        await fetch(`/api/${uri}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // IMPORTANT: send cookies
            body: JSON.stringify({
                code: d3.select("#organization-code").html(),
                label: d3.select("#organization-label").html(),
                fullName: d3.select("#organization-full-name").html(),
                idPrefix: d3.select("#organization-id-prefix").html(),
            })
        })
            .then((response) => response.json())
            .then(async json => {
                organizationDraft = null
                d3.select("#organization-message").html(json.message)
                await loadOrganizations()
            })
    }
}

function newOrganization() {
    if (organizationDraft) {
        const index = d3.select("#new-organization-option").node().index
        d3.select("#organizations").node().selectedIndex = index
        organizationSelect(organizationDraft.code)
    } else {
        organization = {
            code: "",
            label: "",
            fullName: "",
            idPrefix: ""
        }
        organizations.push(organization)
        organizationDraft = organization
        currentOrganization = organization
        d3.select("#organization").style("display", "inherit")
        d3.select("#organizations").append("option").attr("id", "new-organization-option").attr("value", organization.code).property("selected", true).text("New organization")
        displayOrganization(organization)
    }
}


function enterUsers() {
    //Requests selector
    d3.select("#users").html("")
    users.forEach(user => {
        d3.select("#users").append("option").attr("value", user.id).property("selected", currentUser ? currentUser.id == user.id : me.id == user.id)
            .text(user.email)
    })
    d3.select("#users").on("change", e => {
        userSelect(e.target.value)
    })
    if (currentUser) userSelect(currentUser.id)
    else userSelect()
}

async function userSelect(id = null) {
    if (!id) id = me.id
    d3.select("#user").style("display", "inherit")
    currentUser = users.find(user => user.id == id)
    //console.log("User selected", currentUser)
    displayUser(currentUser)
}

function displayUser(user) {

    d3.select("#user-update").text("Update user")
    if (!user?.id)
        d3.select("#user-update").text("Save user")

    d3.select("#user-id").html(user.id)
    d3.select("#user-email").html(user.email)
    d3.select("#user-password").html("")
    d3.select("#user-force-password-change").node().checked = user.forcePasswordChange
    d3.select("#user-is-superadmin").node().checked = user.isSuperAdmin
    d3.select("#user-organization").html("")
    organizations.forEach(organization => {
        let label = organization.fullName + (organization.fullName != organization.label ? " (" + organization.label + ")" : "")
        let length = 50
        if (label.length > length) {
            label = label.substring(0, length - 1) + "…"
        }
        d3.select("#user-organization").append("option").attr("value", organization.code).property("selected", organization.code == user.organizationCode)
            .text(label)
    })
}

async function updateUser() {

    const passwordValue = d3.select("#user-password").text().trim();

    const userUpdate = {
        id: currentUser.id,
        email: d3.select("#user-email").text().trim(),
        isSuperAdmin: d3.select("#user-is-superadmin").property("checked"),
        organization: d3.select("#user-organization").property("value"),
        organizationCode: d3.select("#user-organization").property("value"),
        forcePasswordChange: d3.select("#user-force-password-change").property("checked")
    };

    // Only send password if non-empty
    if (passwordValue.length) {
        userUpdate.password = passwordValue;
    }

    if (currentUser) {
        d3.select("#user-message").html("Uploading changes...")

        let uri = 'update-user'
        if (!currentUser.id) {
            uri = 'create-user'
        }

        await fetch(`/api/${uri}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include', // IMPORTANT: send cookies
            body: JSON.stringify(userUpdate)
        }).then((response) => response.json())
            .then(async json => {
                userDraft = null
                d3.select("#user-message").html(json.message)
                await loadUsers()
            })
    }
}

function newUser() {

    user = {
        email: "",
        password: "",
        organization: ORG,
        organizationCode: ORG,
        isSuperAdmin: false,
        forcePasswordChange: true
    }
    currentUser = user
    d3.select("#user").style("display", "inherit")
    displayUser(user)
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
d3.select("#service-revert").on("click", enterServices)
d3.select("#service-create").on("click", newService)
d3.select("#service-export").on("click", exportServices)

d3.select("#organization-update").on("click", updateOrganization)
d3.select("#organization-revert").on("click", enterOrganizations)
d3.select("#organization-create").on("click", newOrganization)

d3.select("#user-update").on("click", updateUser)
d3.select("#user-revert").on("click", enterUsers)
d3.select("#user-create").on("click", newUser)

d3.select("#header-logout").on("click", logout)

document.addEventListener('DOMContentLoaded', () => {
    const tabs = Array.from(document.querySelectorAll('.admin-tab'));
    const panels = Array.from(document.querySelectorAll('.admin-section'));

    if (!tabs.length || !panels.length) return;

    function activate(id) {
        const panelExists = panels.some(p => p.id === id);
        const safeId = panelExists ? id : panels[0].id;

        tabs.forEach(t => t.classList.toggle('is-active', t.dataset.tab === safeId));
        panels.forEach(p => p.classList.toggle('is-active', p.id === safeId));

        history.replaceState(null, '', '#' + safeId);
    }

    tabs.forEach(t => t.addEventListener('click', () => {
        // Non-superadmins are forced to the service panel only
        if (window.currentUser && !window.currentUser.isSuperAdmin) {
            activate('service-panel');
            return;
        }
        activate(t.dataset.tab);
    }));

    const initial = (location.hash || '').slice(1) || tabs[0].dataset.tab;
    activate(initial);
});