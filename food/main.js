let tooltipsPermanent = false;
let mapFilterMode = "been";
let viewMode = "map";
let sortState = { key: null, direction: null };
let validRestaurants = [];
let validTrySpots = [];
let leafletMap = null;
let selectedMarker = null;

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

    const map = L.map("map", {
        minZoom: 1,
        maxZoom: 20,
        maxBounds: [[-85.051129, -Infinity], [85.051129, Infinity]],
        maxBoundsViscosity: 1,
    }).setView([33.9977671, -118.4748076], 10);
    leafletMap = map;
    const restaurantLayer = L.layerGroup().addTo(map);
    const tryLayer = L.layerGroup();

    L.tileLayer(
        "https://tiles.stadiamaps.com/tiles/stamen_toner/{z}/{x}/{y}{r}.png",
        {
            maxZoom: 20,
            attribution:
                '&copy; <a href="https://stadiamaps.com/attribution/">Stadia Maps</a> &copy; <a href="https://stamen.com/">Stamen Design</a> &copy; <a href="https://openmaptiles.org/">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        },
    ).addTo(map);

    const controls = document.getElementById("map-controls");
    L.DomEvent.disableClickPropagation(controls);
    L.DomEvent.disableScrollPropagation(controls);

    function buildSpotIcon(type) {
        return L.divIcon({
            className: `spot-marker spot-marker-${type}`,
            html: '<span class="spot-marker-dot" aria-hidden="true"></span>',
            iconSize: [28, 28],
            iconAnchor: [14, 14],
        });
    }

    function enableMarkerKeyboard(marker) {
        function bindKeyboard() {
            const element = marker.getElement();
            element.setAttribute("aria-label", marker.options.title);
            element.onkeydown = (event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    marker.fire("click");
                }
            };
        }
        marker.on("add", bindKeyboard);
        if (marker.getElement()) bindKeyboard();
    }

    function drawRestaurantMarkers() {
        restaurantLayer.clearLayers();

        validRestaurants.forEach((restaurant) => {
            const marker = L.marker([restaurant.lat, restaurant.lng], {
                icon: buildSpotIcon("been"),
                title: `${restaurant.Name} — been`,
            }).addTo(restaurantLayer);
            marker.bindTooltip(restaurant.Name, {
                permanent: tooltipsPermanent,
                direction: "bottom",
                className: "map-tooltip",
            });

            marker.on("click", function () {
                openModal(buildRestaurantModal(restaurant), false, marker);
            });
            enableMarkerKeyboard(marker);
        });
    }

    function drawTryMarkers() {
        tryLayer.clearLayers();

        validTrySpots.forEach((spot) => {
            const marker = L.marker([spot.lat, spot.lng], {
                icon: buildSpotIcon("try"),
                title: `${spot.Name} — want to try`,
            }).addTo(tryLayer);

            marker.bindTooltip(spot.Name, {
                permanent: tooltipsPermanent,
                direction: "bottom",
                className: "map-tooltip",
            });

            marker.on("click", function () {
                openModal(buildTryModal(spot), true, marker);
            });
            enableMarkerKeyboard(marker);
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

    const modal = document.getElementById("modal");
    modal.addEventListener("close", () => {
        selectedMarker?.getElement()?.classList.remove("is-selected");
        selectedMarker = null;
    });
    modal.addEventListener("click", (event) => {
        const bounds = modal.getBoundingClientRect();
        if (event.target === modal && (
            event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom
        )) {
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

function openModal(content, isTry = false, marker = null) {
    const modal = document.getElementById("modal");
    selectedMarker?.getElement()?.classList.remove("is-selected");
    selectedMarker = marker;
    selectedMarker?.getElement()?.classList.add("is-selected");
    modal.innerHTML = content;
    modal.classList.toggle("modal-try", isTry);
    modal.showModal();
    modal.scrollTop = 0;
}

function closeModal() {
    document.getElementById("modal").close();
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
            if (type === "been") {
                const sorted = sortData(validRestaurants, sortState.key, sortState.direction);
                openModal(buildRestaurantModal(sorted[idx]));
            } else {
                const sorted = sortData(validTrySpots, sortState.key, sortState.direction);
                openModal(buildTryModal(sorted[idx]), true);
            }
        });
    });
}

loadRestaurants();
