//let infrastructures = []
//let services
//let requests
//let currentRequest
let allResults = []
let query
const nMin = 5
let n = nMin

let allServices = []
let cache = {}

// ---------------------------------------------------------------------------
// UTM tagging for outbound links (search UI)
// ---------------------------------------------------------------------------
// We append UTM params to HTTP(S) links for analytics. Labels shown in the UI
// remain unchanged (UTMs are never displayed).
const DEFAULT_UTM = {
    utm_source: 'cpcr',
    utm_medium: 'service_finder',
    utm_campaign: 'cpcr_service_finder'
};

function withUtm(href, utm = DEFAULT_UTM) {
    try {
        if (!href) return href;
        const raw = String(href).trim();
        if (!raw) return raw;

        // Only tag http(s)
        if (!/^https?:\/\//i.test(raw)) return raw;

        const u = new URL(raw);
        Object.entries(utm || {}).forEach(([k, v]) => {
            if (!k) return;
            if (v == null) return;
            if (!u.searchParams.has(k)) u.searchParams.set(k, String(v));
        });
        return u.toString();
    } catch (e) {
        // If parsing fails, return original
        return href;
    }
}

// ---------------------------------------------------------------------------
// Click logging (public search UI)
// ---------------------------------------------------------------------------
// Sends best-effort analytics to the backend without blocking navigation.
// Backend: POST /api/log-click  (always returns 204)
function logServiceClick(serviceId, assetType, assetId, assetLabel) {
    const payload = {
        serviceId: String(serviceId),
        assetType: String(assetType),
        assetId: String(assetId),
    };

    if (assetLabel != null && String(assetLabel).trim().length) {
        payload.assetLabel = String(assetLabel).trim();
    }

    if (navigator && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('/api/log-click', blob);
        return;
    }

    fetch('/api/log-click', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(payload),
        keepalive: true,
        credentials: 'include',
    }).catch(() => { });
}


let filters = {
    "organization": [],
    "research": [],
    "phase": [],
    "category": [],
    "output": []
}
let outputs = ['consulting', 'datasets', 'IT infrastructure', 'IT tool', 'outsourced service', 'standards', 'templates', 'training']
let researches = ['clinical trials', 'data collection', 'data reuse', 'sample collection', 'sample reuse']
const phases = ["conception", "development", "execution", "completion"]
let categories = ['ethics submission', 'regulatory and contracts', 'statistics and feasibility', 'PPI', 'study design', 'project management', 'quality, monitoring and audit']
let organizations = ['SBP', 'Swiss Cancer Institute', 'SCTO', 'SPHN', 'swissethics']

const rankingDiv = d3.select("#ranking")

const logos = {
    "SBP": {
        "url": "./images/logo_provider_sbp.png",
        "link": "https://swissbiobanking.ch/"
    },
    "SCI": {
        "url": "./images/logo_provider_sci.png",
        "link": "https://www.swisscancerinstitute.ch/"
    },
    "SCTO": {
        "url": "./images/logo_provider_scto.png",
        "link": "https://scto.ch/"
    },
    "SPHN": {
        "url": "./images/logo_provider_sphn.png",
        "link": "https://sphn.ch/"
    },
    "SE": {
        "url": "./images/logo_provider_swissethics.png",
        "link": "https://swissethics.ch/"
    },
    "SwissPedNet": {
        "url": "./images/logo_spd.png",
        "link": "https://www.swisspednet.ch/"
    },

}

const requestField = d3.select("#request-text").on("keydown", function (e) {
    if (e.key == "Enter") {
        this.blur()
        serviceSearch()
    }
})
/*.on("input", function (e) {
    let request = d3.select(this).text().trim()
    d3.select("#search-button").property("disabled", request === "")
})*/

requestField.node().focus()
setTimeout(() => { requestField.node().blur() }, "5")

function shuffle(array) {
    let i = array.length, j, temp;
    while (--i > 0) {
        j = Math.floor(Math.random() * (i + 1));
        temp = array[j];
        array[j] = array[i];
        array[i] = temp;
    }
    return array
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
            allServices = shuffle(json.services)
            //console.log("All services", allServices)
        });
}

function serviceSearch() {
    query = d3.select("#request-text").text()
    query = stripHtml(query).trim()

    if (query && query.length > 0) {
        n = nMin
        d3.select("#layout-container").classed("splash", false)
        d3.select("#result-title").html("Fetching results...")
        requestField.attr("contenteditable", false)
        d3.select(".load-more").style("display", "none")
        rankingDiv.html(""); // Efface les résultats précédents

        if (cache[query]) {
            //console.log("Using cache for query:", query)
            allResults = cache[query].map(result => allServices.find(service => service.id == result.id)).filter(service => service.active)
            requestField.attr("contenteditable", true)
            d3.select("#layout-container").classed("splash", false)
            update(filterAllResults(allResults))
            return
        }
        fetch("/api/search", {
            method: "POST",
            body: JSON.stringify({ "query": query }),
            headers: {
                "Content-type": "application/json; charset=UTF-8"
            }
        })
            .then((response) => response.json())
            .then(async (json) => {
                cache[query] = json.results
                requestField.attr("contenteditable", true)
                d3.select("#layout-container").classed("splash", false)
                allResults = json.results.map(result => allServices.find(service => service.id == result.id)).filter(service => service.active)
                update(filterAllResults(allResults))
            });
    } else {
        n = allServices.length
        d3.select("#layout-container").classed("splash", false)
        d3.select(".load-more").style("display", "none")
        rankingDiv.html(""); // Efface les résultats précédents
        d3.select("#layout-container").classed("splash", false)
        allResults = allServices
        update(filterAllResults(allResults))
    }
}

function loadMore() {
    n += nMin
    update(filterAllResults(allResults))
}

function filterAllResults(results) {
    let filteredResults = filterResults(results, "research")
    filteredResults = filterResults(filteredResults, "phase")
    filteredResults = filterResults(filteredResults, "category")
    filteredResults = filterResults(filteredResults, "output")
    filteredResults = filterResults(filteredResults, "organization")
    return filteredResults
}

function filterResults(results, filter) {
    //console.log(filters[filter])
    return results
        .filter(result => {
            if (filters[filter].length == 0) return true
            let flag = false
            filters[filter].forEach(option => {
                if (filter == "organization") {
                    if (result.organization.label == option) {
                        flag = true
                        return
                    }
                } else {
                    if (result[filter].includes(option)) {
                        flag = true
                        return
                    }
                }
            })
            return flag
        })
}

function clearFilter(filter) {
    filters[filter] = []
    //console.log(filters)
    update(filterAllResults(allResults))
}

function enterFilters() {
    d3.select(".chips").html("")
    addChips("organization", "Infrastructure", organizations)
    addChips("research", "Type of research", researches)
    addChips("phase", "Project phase", phases)
    addChips("category", "Service category", categories)
    addChips("output", "Type of service", outputs)
}

function addChips(filter, name, options) {
    //console.log(name, options)
    const chipWrapper = d3.select(".chips").append("div").attr("class", "chip-wrapper").attr("filter", filter)
    const chipButton = chipWrapper.append("button").attr("class", "chip").attr("data-default", name)
    chipButton.append("span").attr("class", "chip-label").text(name)
    chipButton.append("span").attr("class", "chip-arrow").text("▾")
    chipWrapper.append("button").attr("class", "chip-clear").attr("aria-label", "Clear this filter").style("display", "none").text("×")
    const chipMenu = chipWrapper.append("div").attr("class", "chip-menu")
    const menuHeader = chipMenu.append("div").attr("class", "menu-header")
    menuHeader.append("span").attr("class", "menu-title").text(name)
    menuHeader.append("button").attr("class", "menu-reset").text("Clear")
    options.forEach(option => {
        const label = chipMenu.append("label")
        label.append("input").attr("type", "checkbox").attr("filter", filter).attr("value", option)
            .on("change", function (e) {
                const node = d3.select(this)
                const filter = node.attr("filter")
                const option = node.attr("value")
                const checked = e.target.checked
                //console.log(filter + ": " + option, checked)
                if (checked && !filters[filter].includes(option)) filters[filter].push(option)
                if (!checked && filters[filter].includes(option)) {
                    var index = filters[filter].indexOf(option);
                    if (index !== -1) {
                        filters[filter].splice(index, 1);
                    }
                }
                //console.log("Filters", filters)
                //console.log("Query", query)
                if (query && query.length > 0) {
                    n = nMin
                    update(filterAllResults(allResults))
                } else {
                    n = allServices.length
                    serviceSearch()
                }
            })
        label.append("span").text(" " + option)
    })
}

// Mettre à jour les résultats
function update(results) {

    //console.log("Results", results)
    d3.select("#result-title").html(d => {
        if (results) {
            return results.length > 0 ? "Matching services" : "No matching services"
        }
        else {
            return ""
        }
    }
    )
    const resultsUpdate = rankingDiv.selectAll(".service-wrapper").data(results.slice(0, n), d => d.id)
    resultsUpdate.exit().remove()
    const resultsEnter = resultsUpdate.enter().append("div").attr("class", "service-wrapper")

    //console.log(resultsEnter)

    const serviceTag = resultsEnter.append("div").attr("class", "service-result").html("")
    const explanation = resultsEnter.append("div").attr("class", "explanation").classed("loading", true)
    explanation.append("div").attr("class", "loader-label").text("Generating explanation... (it can take a minute)")
    explanation.append("div").attr("class", "skeleton-line").classed("line1", true)
    explanation.append("div").attr("class", "skeleton-line").classed("line2", true)
    explanation.append("div").attr("class", "skeleton-line").classed("line3", true)


    serviceTag.append("div").attr("class", "explanation-btn").classed("active", true)
    const header = serviceTag.append("div").attr("class", "service-header")
    const reginfra = header.append("div").attr("class", "service-reginfra")
    reginfra.append("a").attr("href", service => logos?.[service.organizationCode]?.link).append("img").attr("src", service => logos?.[service.organizationCode]?.url).attr("class", "logo_infra").style("display", service => logos?.[service.organizationCode] ? "block" : "none")
    reginfra.append("div").text(service => {
        let regional = service?.regional
        if (regional.includes(service.organization.label)) {
            regional.splice(regional.indexOf(service.organizationCode), 1)
        }
        if (!logos?.[service.organizationCode]) regional.unshift(service.organizationCode)
        return Array.isArray(regional) && regional.length > 0 ? "with " + regional.join(", ") : ""
    })
    header.append("div").attr("class", "service-name").text(service => service.name)
    const main = serviceTag.append("div").attr("class", "service-main")
    main.append("div").attr("class", "service-description").text(service => {
        const description = service.description
        const maxChar = 600
        let expanded = false
        if (description.length > maxChar) {
            let short = description.substr(0, maxChar)
            short = short.substr(0, short.lastIndexOf(" "))
            short = short + "(…)"
            let visible = expanded ? description : short
            return visible
        } else {
            return description
        }
    })
    const maxChar = 600
    main.append("a").attr("href", "#").attr("class", "toggle").text("Read more")
        .on("click", function (e, service) {
            e.preventDefault();
            const button = d3.select(this)
            const description = d3.select(this.parentNode).select(".service-description")
            const expanded = button.classed("expanded")
            if (expanded) {
                button.html("Read more").classed("expanded", !expanded)
                let short = service.description.substr(0, maxChar)
                short = short.substr(0, short.lastIndexOf(" "))
                short = short + "(…)"
                description.html(short)
            } else {
                button.html("Show less").classed("expanded", !expanded)
                description.html(service.description)
            }
        })
        .style("display", service => service.description.length > maxChar ? "block" : "none")

    main.append("div").attr("class", "service-info").each(function (service) {

        const node = d3.select(this)

        function truncateLabel(text, max = 60) {
            if (!text) return ""
            const t = String(text)
            return t.length > max ? t.slice(0, max - 1) + "…" : t
        }

        function appendListBlock(node, items, name, renderItem) {
            if (!Array.isArray(items) || items.length === 0) return
            const filtered = items.filter(x => x)
            if (filtered.length === 0) return

            const block = node.append("div").attr("class", "info-block").classed(name.toLowerCase().replaceAll(" ", "-"), true)
            block.append("div").attr("class", "info-label").text(name)
            const valueDiv = block.append("div").attr("class", "info-value")

            filtered.forEach((item, i) => {
                const row = (i === 0) ? valueDiv : valueDiv.append("div")
                renderItem(row, item)
            })
        }

        function appendTextBlock(node, valueArray, name) {
            if (!Array.isArray(valueArray) || valueArray.length === 0) return
            const filtered = valueArray.filter(x => typeof x === 'string' && x.trim().length)
            if (filtered.length === 0) return

            const block = node.append("div").attr("class", "info-block").classed(name.toLowerCase().replaceAll(" ", "-"), true)
            block.append("div").attr("class", "info-label").text(name)
            block.append("div").attr("class", "info-value").text(filtered.join(", "))
        }

        // NEW: documents: [{ title, url, order }]
        appendListBlock(node, (service.documents || []), "Documents", (row, doc) => {
            const title = truncateLabel(doc?.title || doc?.label || doc?.url || "Document")
            const href = String(doc?.url || "").trim()
            if (!href) {
                row.text(title)
                return
            }
            row.append("a")
                .attr("class", "itemLink")
                .attr("target", "_blank")
                .attr("rel", "noopener")
                .attr("href", href)
                .text(title)
                .on("click", function () {
                    const aid = doc?.id || href || title;
                    const lbl = title || href || aid;
                    if (aid) logServiceClick(service.id, "document", aid, lbl);
                });
        })

        // NEW: links: [{ label, url, order }]
        appendListBlock(node, (service.links || []), "Links", (row, link) => {
            const label = truncateLabel(link?.label || link?.url || "Link")
            const rawHref = String(link?.url || "").trim()
            const href = withUtm(rawHref)
            if (!href) {
                row.text(label)
                return
            }
            row.append("a")
                .attr("class", "itemLink")
                .attr("target", "_blank")
                .attr("rel", "noopener")
                .attr("href", href)
                .text(label)
                .on("click", function () {
                    const aid = link?.id || rawHref || label;
                    const lbl = label || rawHref || aid;
                    if (aid) logServiceClick(service.id, "link", aid, lbl);
                });
        })

        // existing: output is still a string[]
        appendTextBlock(node, service.output, "Type of service")

        // NEW: contacts: [{ type, value, label, order }]
        appendListBlock(node, (service.contacts || []), "Contact", (row, c) => {
            const type = String(c?.type || "OTHER").toUpperCase()
            const value = String(c?.value || "").trim()
            const label = truncateLabel(c?.label || value)

            if (!value) {
                row.text(label)
                return
            }

            let href = value
            if (type === 'EMAIL') href = 'mailto:' + value
            else if (type === 'PHONE') href = 'tel:' + value
            else if (type === 'URL' && !/^https?:\/\//i.test(value)) href = 'https://' + value

            row.append("a")
                .attr("class", "itemLink")
                .attr("target", (type === 'EMAIL' || type === 'PHONE') ? null : "_blank")
                .attr("rel", (type === 'EMAIL' || type === 'PHONE') ? null : "noopener")
                .attr("href", href)
                .text(label)
                .on("click", function () {
                    const aid = c?.id || href || label || c?.value;
                    const lbl = label || c?.value || href || aid;
                    if (aid) logServiceClick(service.id, "contact", aid, lbl);
                });
        })

        // TEMP fallback for legacy fields (optional):
        // If your backend still returns legacy arrays for some services, you can uncomment these.
        // appendListBlock(node, (service.docs || []), "Documents", (row, s) => row.text(String(s)))
        // appendListBlock(node, (service.url || []), "Links", (row, s) => row.text(String(s)))
        // appendListBlock(node, (service.contact || []), "Contact", (row, s) => row.text(String(s)))

    })


    //serviceTag.append("div").attr("class", "explanation")

    serviceTag.select(".service-keywords").append("span").html(service => service.id + ": " + Math.round(100 * service.score) + "%")
    serviceTag.select(".explanation-btn")
        .on("click", async function (e, service) {
            if (d3.select(this).classed("active")) {
                d3.select(this).classed("active", false)
                const explanation = d3.select(this.parentNode.parentNode).select(".explanation")
                explanation.classed("open", true)
                let query = d3.select("#request-text").html()
                query = stripHtml(query)
                await fetch("/api/explain-match", {
                    method: "POST",
                    body: JSON.stringify({ query: query, match: service }),
                    headers: {
                        "Content-type": "application/json; charset=UTF-8"
                    }
                })
                    .then((response) => response.json())
                    .then(async (json) => {
                        //console.log("Explanation", json)
                        explanation.classed("loading", false).select(".loader-label").html("Why this result?")
                        explanation.selectAll(".skeleton-line").remove()
                        explanation.append("div").attr("class", "explanation-text").text(json.text)
                    })
            }
        })

    d3.select(".load-more").style("display", n + nMin <= results.length ? "block" : "none")


}

enterFilters()
d3.select(".load-more").on("click", (e, d) => { loadMore() })
loadServices()


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

(function () {
    const MAX_LABEL_CHARS = 36; // tronque l’affichage quand plusieurs items

    // met à jour le texte du chip selon les cases cochées
    function updateChipLabel(wrapper) {
        const button = wrapper.querySelector('.chip');
        const defaultLabel = button.dataset.default || 'Filter';
        const selected = [...wrapper.querySelectorAll('.chip-menu input[type="checkbox"]:checked')]
            .map(cb => cb.value);

        const arrow = button.querySelector('.chip-arrow');
        const clearBtn = wrapper.querySelector('.chip-clear');

        if (selected.length === 0) {
            button.classList.remove('active');
            if (arrow) arrow.style.display = '';
            if (clearBtn) clearBtn.style.display = 'none';
            button.querySelector('.chip-label').textContent = defaultLabel;
            return;
        }

        // états visuels
        button.classList.add('active');
        if (arrow) arrow.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'block';

        // texte
        if (selected.length === 1) {
            button.querySelector('.chip-label').textContent = `${selected[0]}`;
        } else {
            const joined = selected.join(', ');
            const truncated = joined.length > MAX_LABEL_CHARS ? joined.slice(0, MAX_LABEL_CHARS) + '…' : joined;
            button.querySelector('.chip-label').textContent = truncated;
        }
    }

    // ouvre/ferme un menu, ferme les autres
    function toggleMenu(wrapper) {
        const menu = wrapper.querySelector('.chip-menu');
        const isOpen = menu.classList.contains('open');
        document.querySelectorAll('.chip-menu.open').forEach(m => m.classList.remove('open'));
        if (!isOpen) menu.classList.add('open');
    }

    // init pour chaque chip
    document.querySelectorAll('.chip-wrapper').forEach(wrapper => {
        const chipBtn = wrapper.querySelector('.chip');
        const menu = wrapper.querySelector('.chip-menu');
        const clearInChip = wrapper.querySelector('.chip-clear');
        const resetInMenu = wrapper.querySelector('.menu-reset');

        // ouverture/fermeture au clic sur le chip
        chipBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMenu(wrapper);
        });

        // clic en dehors => fermer
        document.addEventListener('click', (e) => {
            if (!wrapper.contains(e.target)) menu.classList.remove('open');
        });

        // cocher/décocher => mettre à jour label
        menu.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => updateChipLabel(wrapper));
        });

        // bouton "Clear" dans le menu (celui qui ne marche pas chez toi)
        resetInMenu?.addEventListener('click', (e) => {
            e.preventDefault();
            // décocher toutes les cases
            menu.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => cb.checked = false);
            // maj label + état
            updateChipLabel(wrapper);
            const filter = d3.select(wrapper).attr("filter")
            clearFilter(filter)
        });

        // croix à droite du chip (reset global de ce filtre)
        clearInChip?.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => cb.checked = false);
            updateChipLabel(wrapper);
            const filter = d3.select(wrapper).attr("filter")
            clearFilter(filter)
        });

        // init label au chargement
        updateChipLabel(wrapper);
    });
})();