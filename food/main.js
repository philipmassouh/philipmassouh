let tooltipsPermanent = false;
let mapFilterMode = "been";
let viewMode = "map";
let sortState = { key: null, direction: null };
let validRestaurants = [];
let validTrySpots = [];
let leafletMap = null;

const MAP_FILTER_MODES = ["been", "try", "both"];

async function loadRestaurants() {
    const [restaurantsResponse, tryResponse] = await Promise.all([
        fetch("restaurants.json"),
        fetch("try.json"),
    ]);
    const [restaurants, trySpots] = await Promise.all([
        restaurantsResponse.json(),
        tryResponse.json(),
    ]);

    function hasCoordinates(place) {
        return Number.isFinite(place.lat) && Number.isFinite(place.lng);
    }

    validRestaurants = restaurants.filter(hasCoordinates);
    validTrySpots = trySpots.filter(hasCoordinates);

    const map = L.map("map").setView([33.9977671, -118.4748076], 10);
    leafletMap = map;
    const restaurantLayer = L.layerGroup().addTo(map);
    const tryLayer = L.layerGroup();

    L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        {
            attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        },
    ).addTo(map);

    const controls = document.getElementById("map-controls");
    L.DomEvent.disableClickPropagation(controls);
    L.DomEvent.disableScrollPropagation(controls);

    function buildTryIcon() {
        return L.divIcon({
            className: "try-marker",
            html: '<div class="try-marker-question">?</div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12],
        });
    }

    function drawRestaurantMarkers() {
        restaurantLayer.clearLayers();

        validRestaurants.forEach((restaurant) => {
            const marker = L.circleMarker([restaurant.lat, restaurant.lng], {
                radius: 7.5,
                fillColor: "transparent",
                color: "#00a896",
                weight: 2,
                opacity: 1,
                fillOpacity: 1.0,
            }).addTo(restaurantLayer);
            marker.bindTooltip(restaurant.Name.toLowerCase(), {
                permanent: tooltipsPermanent,
                direction: "bottom",
                className: "map-tooltip",
            });

            marker.on("click", function () {
                const modalContent = document.getElementById("modal");
                modalContent.innerHTML = buildRestaurantModal(restaurant);
                const modal = document.getElementById("modal");
                modal.classList.remove("modal-try");
                modal.style.visibility = "visible";
            });
        });
    }

    function drawTryMarkers() {
        tryLayer.clearLayers();

        validTrySpots.forEach((spot) => {
            const marker = L.marker([spot.lat, spot.lng], {
                icon: buildTryIcon(),
            }).addTo(tryLayer);

            marker.bindTooltip(spot.Name.toLowerCase(), {
                permanent: tooltipsPermanent,
                direction: "bottom",
                className: "map-tooltip",
            });

            marker.on("click", function () {
                const modalContent = document.getElementById("modal");
                modalContent.innerHTML = buildTryModal(spot);
                const modal = document.getElementById("modal");
                modal.classList.add("modal-try");
                modal.style.visibility = "visible";
            });
        });
    }

    function syncLayerVisibility() {
        const showRestaurants = mapFilterMode === "been" || mapFilterMode === "both";
        const showTrySpots = mapFilterMode === "try" || mapFilterMode === "both";

        if (showRestaurants && !map.hasLayer(restaurantLayer)) {
            restaurantLayer.addTo(map);
        }

        if (!showRestaurants && map.hasLayer(restaurantLayer)) {
            map.removeLayer(restaurantLayer);
        }

        if (showTrySpots && !map.hasLayer(tryLayer)) {
            tryLayer.addTo(map);
        }

        if (!showTrySpots && map.hasLayer(tryLayer)) {
            map.removeLayer(tryLayer);
        }
    }

    function setMapFilterMode(nextMode) {
        if (!MAP_FILTER_MODES.includes(nextMode)) {
            return;
        }

        mapFilterMode = nextMode;
        syncLayerVisibility();
        syncFilterControls();
        if (viewMode === "table") {
            sortState = { key: null, direction: null };
            renderTableView();
        }
    }

    function syncFilterControls() {
        const tooltipButton = document.getElementById("toggle-tooltips");
        tooltipButton.classList.toggle("is-active", tooltipsPermanent);
        tooltipButton.setAttribute("aria-pressed", String(tooltipsPermanent));

        MAP_FILTER_MODES.forEach((mode) => {
            const button = document.getElementById(`filter-${mode}`);
            const isActive = mode === mapFilterMode;

            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
        });
    }

    function drawMarkers() {
        drawRestaurantMarkers();
        drawTryMarkers();
        syncLayerVisibility();
    }

    drawMarkers();
    syncFilterControls();

    //NOTE:if loadRestaurants is called again this will have unexpected behavior
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeModal();
        }
    });

    document.getElementById("toggle-tooltips").addEventListener("click", () => {
        tooltipsPermanent = !tooltipsPermanent;
        drawMarkers();
        syncFilterControls();
    });

    MAP_FILTER_MODES.forEach((mode) => {
        document.getElementById(`filter-${mode}`).addEventListener("click", () => {
            setMapFilterMode(mode);
        });
    });

    document.getElementById("toggle-table").addEventListener("click", () => {
        setViewMode(viewMode === "table" ? "map" : "table");
    });
}

function closeModal() {
    const modal = document.getElementById("modal");
    modal.style.visibility = "hidden";
    modal.classList.remove("modal-try");
}

function setViewMode(mode) {
    viewMode = mode;
    const mapEl = document.getElementById("map");
    const tableEl = document.getElementById("table-view");
    const tableChip = document.getElementById("toggle-table");
    const namesChip = document.getElementById("toggle-tooltips");

    if (mode === "table") {
        mapEl.style.display = "none";
        tableEl.style.display = "block";
        tableChip.classList.add("is-active");
        namesChip.style.display = "none";
        sortState = { key: null, direction: null };
        renderTableView();
    } else {
        mapEl.style.display = "block";
        tableEl.style.display = "none";
        tableChip.classList.remove("is-active");
        namesChip.style.display = "";
        if (leafletMap) leafletMap.invalidateSize();
    }
}

function sortData(data, key, direction) {
    if (!key || !direction) return data;
    const sorted = [...data];
    const numericKeys = ["Food", "Value", "Price", "Noise", "Chaos", "Atmosphere", "Service"];
    const boolKeys = ["Patio"];

    sorted.sort((a, b) => {
        let valA, valB;
        if (numericKeys.includes(key)) {
            valA = a[key] || 0;
            valB = b[key] || 0;
        } else if (boolKeys.includes(key)) {
            valA = a[key] ? 1 : 0;
            valB = b[key] ? 1 : 0;
        } else if (key === "Tags") {
            valA = (a.Tags || [])[0] || "";
            valB = (b.Tags || [])[0] || "";
        } else {
            valA = (a[key] || "").toLowerCase();
            valB = (b[key] || "").toLowerCase();
        }

        if (valA < valB) return direction === "asc" ? -1 : 1;
        if (valA > valB) return direction === "asc" ? 1 : -1;
        return 0;
    });
    return sorted;
}

function renderTableView() {
    const tableEl = document.getElementById("table-view");
    const showBeen = mapFilterMode === "been" || mapFilterMode === "both";
    const showTry = mapFilterMode === "try" || mapFilterMode === "both";
    let html = "";

    if (showBeen) {
        const sorted = sortData(validRestaurants, sortState.key, sortState.direction);
        if (mapFilterMode === "both") {
            html += '<h2 class="table-section-header">Been</h2>';
        }
        html += buildBeenTableHTML(sorted, sortState.key, sortState.direction);
    }

    if (showTry) {
        const sorted = sortData(validTrySpots, sortState.key, sortState.direction);
        if (mapFilterMode === "both") {
            html += '<h2 class="table-section-header table-section-try">Try</h2>';
        }
        html += buildTryTableHTML(sorted, sortState.key, sortState.direction);
    }

    tableEl.innerHTML = html;

    tableEl.querySelectorAll("th[data-sort-key]").forEach((th) => {
        th.addEventListener("click", (e) => {
            const key = e.target.dataset.sortKey;
            if (sortState.key === key) {
                if (sortState.direction === "desc") sortState.direction = "asc";
                else if (sortState.direction === "asc") { sortState.key = null; sortState.direction = null; }
            } else {
                const numericKeys = ["Food", "Value", "Price", "Patio"];
                sortState.key = key;
                sortState.direction = numericKeys.includes(key) ? "desc" : "asc";
            }
            renderTableView();
        });
    });

    tableEl.querySelectorAll("tr[data-index]").forEach((tr) => {
        tr.addEventListener("click", () => {
            const idx = parseInt(tr.dataset.index, 10);
            const type = tr.dataset.type;
            const modal = document.getElementById("modal");

            if (type === "been") {
                const sorted = sortData(validRestaurants, sortState.key, sortState.direction);
                modal.innerHTML = buildRestaurantModal(sorted[idx]);
                modal.classList.remove("modal-try");
            } else {
                const sorted = sortData(validTrySpots, sortState.key, sortState.direction);
                modal.innerHTML = buildTryModal(sorted[idx]);
                modal.classList.add("modal-try");
            }
            modal.style.visibility = "visible";
        });
    });
}

loadRestaurants();
