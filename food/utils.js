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

    const thead = buildTableHead(columns, sortKey, sortDirection);

    const tbody = restaurants.map((r, i) => {
        return `<tr data-index="${i}" data-type="been">
            <td class="table-name">${r.Name}</td>
            <td>${buildTagLine(r.Tags)}</td>
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

    const thead = buildTableHead(columns, sortKey, sortDirection);

    const tbody = trySpots.map((s, i) => {
        return `<tr data-index="${i}" data-type="try">
            <td class="table-name">${s.Name}</td>
            <td>${s.Notes || ""}</td>
            <td><a href="${addressToLink(s.Addresses)}" target="_blank" rel="noreferrer" class="table-address" onclick="event.stopPropagation()">${s.Addresses}</a></td>
        </tr>`;
    }).join("");

    return `<table class="spot-table spot-table-try"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

function buildTableHead(columns, sortKey, sortDirection) {
    return columns.map((col) => {
        let arrow = "";
        if (col.key === sortKey) {
            arrow = sortDirection === "asc" ? " ▲" : " ▼";
        }
        return `<th class="label" data-sort-key="${col.key}">${col.label}${arrow}</th>`;
    }).join("");
}

function buildTagLine(tags) {
    return (tags || []).join(" / ");
}

function addressToLink(address) {
    const query = encodeURIComponent(address);
    const link = `https://www.google.com/maps/search/?api=1&query=${query}`;
    return link;
}

function buildLinks(links) {
    const html = links
        .filter(([url]) => url)
        .map(([url, label]) => `<a class="label" href="${url}" target="_blank" rel="noreferrer">${label} <span aria-hidden="true">↗</span></a>`)
        .join("");
    return html ? `<nav class="panel-links" aria-label="Links">${html}</nav>` : "";
}

function buildCloseButton() {
    return `<button type="button" id="close-btn" aria-label="Close place details" onclick="closeModal()">×</button>`;
}

function buildPanelHead(label) {
    return `
        <div class="panel-head">
            <p class="panel-tags label">${label}</p>
            ${buildCloseButton()}
        </div>
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
        <table class="panel-ratings" aria-label="Place ratings"><tbody>
            <tr><th class="label" scope="row">Patio</th><td aria-label="${restaurant.Patio ? "Yes" : "No"}"><span class="emoji-rating" aria-hidden="true">${restaurant.Patio ? "✅" : "❌"}</span></td></tr>
            ${ratings.map(([key, emoji]) => `
                <tr><th class="label" scope="row">${key}</th><td aria-label="${restaurant[key]} out of 5"><span class="emoji-rating" aria-hidden="true">${scoreToEmoji(restaurant[key], emoji)}</span></td></tr>
            `).join("")}
        </tbody></table>
    `;
}

function buildRestaurantModal(restaurant) {
    return `
        ${buildPanelHead(buildTagLine(restaurant.Tags))}
        <h2 id="modal-title">${restaurant.Name}</h2>
        ${buildTable(restaurant)}
        <p class="panel-address">
            <a href="${addressToLink(restaurant.Addresses)}" target="_blank" rel="noreferrer">${restaurant.Addresses} ↗</a>
        </p>
        ${restaurant.Comments ? `<p class="panel-quote">${restaurant.Comments}</p>` : ""}
        ${buildLinks([
            [restaurant.Site, "Website"],
            [restaurant.Instagram, "Instagram"],
            [restaurant.Yelp, "Yelp"],
        ])}
    `;
}

function buildTryModal(spot) {
    return `
        ${buildPanelHead("Try")}
        <h2 id="modal-title">${spot.Name}</h2>
        <p class="panel-address">
            <a href="${addressToLink(spot.Addresses)}" target="_blank" rel="noreferrer">${spot.Addresses} ↗</a>
        </p>
        ${spot.Notes ? `<p class="panel-quote">${spot.Notes}</p>` : ""}
        ${buildLinks([[spot.Site, "Website"]])}
    `;
}
