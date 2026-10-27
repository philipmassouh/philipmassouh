function scoreToDots(score) {
    if (score === 0) return "—";
    const filled = '<span class="dot-filled">●</span>'.repeat(score);
    const empty = '<span class="dot-empty">○</span>'.repeat(5 - score);
    return filled + empty;
}

function buildBeenTableHTML(restaurants, sortKey, sortDirection) {
    const columns = [
        { key: "Name", label: "Name" },
        { key: "Tags", label: "Tags" },
        { key: "Food", label: "Food" },
        { key: "Value", label: "Value" },
        { key: "Price", label: "Price" },
        { key: "Patio", label: "Patio" },
        { key: "Addresses", label: "Address" },
    ];

    const thead = columns.map((col) => {
        let arrow = "";
        if (col.key === sortKey) {
            arrow = sortDirection === "asc" ? " ▲" : " ▼";
        }
        return `<th data-sort-key="${col.key}">${col.label}${arrow}</th>`;
    }).join("");

    const tbody = restaurants.map((r, i) => {
        const tags = (r.Tags || []).map((t) => `<span class="table-tag">${t}</span>`).join("");
        return `<tr data-index="${i}" data-type="been">
            <td class="table-name">${r.Name}</td>
            <td>${tags}</td>
            <td class="table-score">${scoreToDots(r.Food)}</td>
            <td class="table-score">${scoreToDots(r.Value)}</td>
            <td class="table-score">${scoreToDots(r.Price)}</td>
            <td class="table-patio">${r.Patio ? "✓" : "—"}</td>
            <td><a href="${addressToLink(r.Addresses)}" target="_blank" rel="noreferrer" class="table-address" onclick="event.stopPropagation()">${r.Addresses}</a></td>
        </tr>`;
    }).join("");

    return `<table class="spot-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function buildTryTableHTML(trySpots, sortKey, sortDirection) {
    const columns = [
        { key: "Name", label: "Name" },
        { key: "Notes", label: "Notes" },
        { key: "Addresses", label: "Address" },
    ];

    const thead = columns.map((col) => {
        let arrow = "";
        if (col.key === sortKey) {
            arrow = sortDirection === "asc" ? " ▲" : " ▼";
        }
        return `<th data-sort-key="${col.key}">${col.label}${arrow}</th>`;
    }).join("");

    const tbody = trySpots.map((s, i) => {
        return `<tr data-index="${i}" data-type="try">
            <td class="table-name">${s.Name}</td>
            <td>${s.Notes || ""}</td>
            <td><a href="${addressToLink(s.Addresses)}" target="_blank" rel="noreferrer" class="table-address" onclick="event.stopPropagation()">${s.Addresses}</a></td>
        </tr>`;
    }).join("");

    return `<table class="spot-table spot-table-try"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function addressToLink(address) {
    const query = encodeURIComponent(address);
    const link = `https://www.google.com/maps/search/?api=1&query=${query}`;
    return link;
}

function buildLinkButton(url, label) {
    if (!url) {
        return "";
    }

    return `
        <a class="link-btn" href="${url}" target="_blank" rel="noreferrer">${label} <span aria-hidden="true">↗</span></a>
    `;
}

function buildCloseButton() {
    return `
        <button type="button" id="close-btn" aria-label="Close place details" onclick="closeModal()" autofocus>×</button>
    `;
}

function buildButtons(restaurant) {
    return `
        ${buildLinkButton(restaurant.Site, "Website")}
        ${buildLinkButton(restaurant.Instagram, "Instagram")}
        ${buildLinkButton(restaurant.Yelp, "Yelp")}
    `;
}

function buildTags(restaurant) {
    return `
        ${restaurant.Tags.map((tag) => `<span class="modal-tag">${tag}</span>`).join("")}
    `;
}

function scoreToEmoji(score, emoji) {
    if (score === 0) return "🚫";
    return emoji.repeat(score);
}

function buildTable(restaurant) {
    const ratings = [
        ["Noise", "👂"],
        ["Chaos", "💥"],
        ["Atmosphere", "⛩️"],
        ["Service", "😌"],
        ["Food", "🧑‍🍳"],
        ["Value", "⭐️"],
        ["Price", "💰"],
    ];
    return `
        <table aria-label="Place ratings"><tbody>
            <tr><th scope="row">Patio</th><td aria-label="${restaurant.Patio ? "Yes" : "No"}"><span aria-hidden="true">${restaurant.Patio ? "✅" : "❌"}</span></td></tr>
            ${ratings.map(([key, emoji]) => `
                <tr><th scope="row">${key}</th><td aria-label="${restaurant[key]} out of 5"><span class="emoji-rating" aria-hidden="true">${scoreToEmoji(restaurant[key], emoji)}</span></td></tr>
            `).join("")}
        </tbody></table>
    `;
}

function buildRestaurantModal(restaurant) {
    return `
        ${buildCloseButton()}
        <div id="modal-left">
            <h1 id="modal-title">
                ${restaurant.Name}
            </h1>
            <div id="modal-tags">
                ${buildTags(restaurant)}
            </div>
            <div id="modal-table">
                ${buildTable(restaurant)}
            </div>
            <div id="modal-address">
                <a href="${addressToLink(restaurant.Addresses)}" target="_blank" rel="noreferrer">${restaurant.Addresses} ↗</a>
            </div>
            <div id="modal-quote">${restaurant.Comments || ""}</div>
        </div>
        <div id="modal-right">
            ${buildButtons(restaurant)}
        </div>
    `;
}

function buildTryModal(spot) {
    const notes = spot.Notes
        ? `
            <div id="modal-quote">${spot.Notes}</div>
        `
        : "";

    return `
        ${buildCloseButton()}
        <div id="modal-left">
            <p class="modal-eyebrow">On the list</p>
            <h1 id="modal-title">
                ${spot.Name}
            </h1>
            <div id="modal-address">
                <a href="${addressToLink(spot.Addresses)}" target="_blank" rel="noreferrer">${spot.Addresses}</a>
            </div>
            ${notes}
        </div>
        <div id="modal-right">
            ${buildLinkButton(spot.Site, "Website")}
        </div>
    `;
}
