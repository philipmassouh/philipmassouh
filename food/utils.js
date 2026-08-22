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

function scoreToEmoji(score, emoji) {
    if (score === 0) {
        return "🚫";
    }
    return emoji.repeat(score);
}

function buildLinkButton(url, iconClass) {
    if (!url) {
        return "";
    }

    return `
        <div><button type="button" class="link-btn"><a href="${url}" target="_blank" rel="noreferrer"><i class="${iconClass}"></i></a></button></div>
    `;
}

function buildCloseButton() {
    return `
        <div><button type="button" class="link-btn" id="close-btn" onclick="closeModal()">  <i id="close-icon" class="fa-solid fa-xmark">       </i></button></div>
    `;
}

function buildButtons(restaurant) {
    return `
        ${buildCloseButton()}
        ${buildLinkButton(restaurant.Site, "fa-solid fa-link")}
        ${buildLinkButton(restaurant.Instagram, "fa-brands fa-instagram")}
        ${buildLinkButton(restaurant.Yelp, "fa-brands fa-yelp")}
    `;
}

function buildTags(restaurant) {
    return `
        ${restaurant.Tags.map((tag) => `<span class="modal-tag">${tag}</span>`).join("")}
    `;
}

function buildTable(restaurant) {
    return `
        <table id="modal-table">
            <tr><td>Patio      </td><td>${restaurant.Patio ? "✅" : "❌"}           </td></tr>
            <tr><td>Noise      </td><td>${scoreToEmoji(restaurant.Noise, "👂")}     </td></tr>
            <tr><td>Chaos      </td><td>${scoreToEmoji(restaurant.Chaos, "💥")}     </td></tr>
            <tr><td>Atmosphere </td><td>${scoreToEmoji(restaurant.Atmosphere, "⛩️")}</td></tr>
            <tr><td>Service    </td><td>${scoreToEmoji(restaurant.Service, "😌")}   </td></tr>
            <tr><td>Food       </td><td>${scoreToEmoji(restaurant.Food, "🧑‍🍳")}      </td></tr>
            <tr><td>Value      </td><td>${scoreToEmoji(restaurant.Value, "⭐️")}     </td></tr>
            <tr><td>Price      </td><td>${scoreToEmoji(restaurant.Price, "💰")}     </td></tr>
        </table>
    `;
}

function buildRestaurantModal(restaurant) {
    return `
        <div id="modal-left">
            <div id="modal-title">
                ${restaurant.Name}
            </div>
            <div id="modal-tags">
                ${buildTags(restaurant)}
            </div>
            <div id="modal-table">
                ${buildTable(restaurant)}
            </div>
            <div id="modal-address">
                <a href="${addressToLink(restaurant.Addresses)}" target="_blank">${restaurant.Addresses}</a>
            </div>
            <div id="modal-quote">
                ${restaurant.Comments}
            </div>
        </div>
        <div id="modal-right">
            ${buildButtons(restaurant)}
        </div>
    `;
}

function buildTryModal(spot) {
    const notes = spot.Notes
        ? `
            <div id="modal-quote">
                ${spot.Notes}
            </div>
        `
        : "";

    return `
        <div id="modal-left">
            <div id="modal-title">
                ${spot.Name}
            </div>
            <div id="modal-tags">
                <span class="modal-tag">try</span>
            </div>
            <div id="modal-address">
                <a href="${addressToLink(spot.Addresses)}" target="_blank" rel="noreferrer">${spot.Addresses}</a>
            </div>
            ${notes}
        </div>
        <div id="modal-right">
            ${buildCloseButton()}
            ${buildLinkButton(spot.Site, "fa-solid fa-link")}
        </div>
    `;
}
