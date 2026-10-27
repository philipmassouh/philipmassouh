# food
website with every place ive eaten and my opinion (im not a foodie)

## Basemap setup

The map uses Stamen Watercolor raster tiles hosted by Stadia Maps, directly in Leaflet.

- Before deploying, create a [Stadia Maps account](https://client.stadiamaps.com/signup/) and register `philipmassouh.com` under Manage Properties → Authentication Configuration. Register any other domains used to serve the site as well.
- Domain authentication means no API key is needed in the source. Keep the map attribution visible.
- The free plan is for non-commercial use and includes 200,000 credits/month (one credit per raster tile). Check [current pricing](https://stadiamaps.com/pricing/) before deploying.
- For local previews, run `python3 -m http.server 8765` from the repository root and open `http://localhost:8765/food/`. Stadia allows localhost requests without authentication, subject to rate limits.
- Watercolor's original tileset has some missing tiles, especially at high zoom. Requests stop at zoom 16; closer views enlarge those tiles instead of requesting nonexistent zoom levels.
