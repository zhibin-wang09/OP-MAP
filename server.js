const express = require('express');
const {Client} = require('pg');
const fetch = require('node-fetch');
const client = new Client({
    host: 'localhost',
    port : '5432',
    database: 'gis',
    user :'renderer',
    password :'renderer'
});

const app = express();
app.use(express.json());
// the following query does this
// Given bounding box with minLat, minLon, maxLat, maxLon we are going to search objects in the table
// called planet_osm_point, planet_osm_roads, planet_osm_line, planet_osm_polygon if the boolean value
// 'onlyInBox' is true otherwise we search the whole map. Each record in the previous four tables contains
// an attribute call osm_id and this id is used to match the id in planet_osm_node table to get the coordinate.
// Then the query result across the 4 tables are joined
// aand sorted base on its distance from the center of the bounding box.
app.post("/api/search", async (req,res)=>{
	console.log(req.body);
    const {minLat, minLon, maxLat, maxLon} = req.body.bbox;
    const onlyInBox = req.body.onlyInBox;
    const search_string = req.body.searchTerm;
    const query = {
        text: `
          WITH search_results AS (
            SELECT
              name,
              osm_id,
              'line' AS type,
              MIN(n.lat) AS min_lat,
              MAX(n.lat) AS max_lat,
              MIN(n.lon) AS min_lon,
              MAX(n.lon) AS max_lon
            FROM planet_osm_line
            WHERE name LIKE $1
              AND (
                $6 = false
                OR (
                  $6 = true
                  AND EXISTS (
                    SELECT 1
                    FROM planet_osm_nodes n
                    WHERE planet_osm_line.osm_id = n.id
                      AND n.lat BETWEEN $2 AND $3
                      AND n.lon BETWEEN $4 AND $5
                  )
                )
              )
            GROUP BY name, osm_id
      
            UNION ALL
      
            SELECT
              name,
              osm_id,
              'road' AS type,
              MIN(n.lat) AS min_lat,
              MAX(n.lat) AS max_lat,
              MIN(n.lon) AS min_lon,
              MAX(n.lon) AS max_lon
            FROM planet_osm_roads
            WHERE name LIKE $1
              AND (
                $6 = false
                OR (
                  $6 = true
                  AND EXISTS (
                    SELECT 1
                    FROM planet_osm_nodes n
                    WHERE planet_osm_roads.osm_id = n.id
                      AND n.lat BETWEEN $2 AND $3
                      AND n.lon BETWEEN $4 AND $5
                  )
                )
              )
            GROUP BY name, osm_id
      
            UNION ALL
      
            SELECT
              name,
              osm_id,
              'polygon' AS type,
              MIN(n.lat) AS min_lat,
              MAX(n.lat) AS max_lat,
              MIN(n.lon) AS min_lon,
              MAX(n.lon) AS max_lon
            FROM planet_osm_polygon
            WHERE name LIKE $1
              AND (
                $6 = false
                OR (
                  $6 = true
                  AND EXISTS (
                    SELECT 1
                    FROM planet_osm_nodes n
                    WHERE planet_osm_polygon.osm_id = n.id
                      AND n.lat BETWEEN $2 AND $3
                      AND n.lon BETWEEN $4 AND $5
                  )
                )
              )
            GROUP BY name, osm_id
      
            UNION ALL
      
            SELECT
              name,
              osm_id,
              'point' AS type,
              n.lat AS min_lat,
              n.lat AS max_lat,
              n.lon AS min_lon,
              n.lon AS max_lon
            FROM planet_osm_point
            JOIN planet_osm_nodes n ON planet_osm_point.osm_id = n.id
            WHERE name LIKE $1
              AND (
                $6 = false
                OR (
                  $6 = true
                  AND n.lat BETWEEN $2 AND $3
                  AND n.lon BETWEEN $4 AND $5
                )
              )
          )
          SELECT
            name,
            JSON_BUILD_OBJECT(
              'lat', (min_lat + max_lat) / 2,
              'lon', (min_lon + max_lon) / 2
            ) AS coordinates,
            JSON_BUILD_OBJECT(
              'minLat', min_lat,
              'minLon', min_lon,
              'maxLat', max_lat,
              'maxLon', max_lon
            ) AS bbox
          FROM search_results
          ORDER BY
            ABS(min_lat - ($2 + ($3 - $2) / 2)) + ABS(min_lon - ($4 + ($5 - $4) / 2)),
            ABS(max_lat - ($2 + ($3 - $2) / 2)) + ABS(max_lon - ($4 + ($5 - $4) / 2));
        `,
        values: [`%${search_string}%`, minLat, maxLat, minLon, maxLon, onlyInBox]
      };
    let result = await client.query(query);
    res.status(200).json(result);
})


app.get('/tiles/:z/:x/:y.png', async (req, res) => {
  try {
    const tileResponse = await fetch(`http://127.0.0.1:8080/tile/${req.params.z}/${req.params.x}/${req.params.y}.png`);
    const tileBuffer = await tileResponse.buffer();

    res.status(200).type('image/png').send(tileBuffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const TILE_SIZE = 256;

app.post('/convert', (req,res)=>{
  const zoom = req.zoom;
  const lat = req.lat;
  const long = req.lon;

  const scale = 1 << zoom;
  const worldCooridnate = project(lat,lon);
  const tileCoordinate = {
    x: Math.floor((worldCooridnate.x * scale) / TILE_SIZE),
    y: Math.floor((worldCooridnate.y * scale) / TILE_SIZE)
  }

  res.status(200).json(tileCoordinate);
})

function project(lat, lon){
  let siny = Math.sin((lat * Math.PI) / 180);

  // Truncating to 0.9999 effectively limits latitude to 89.189. This is
  // about a third of a tile past the edge of the world tile.
  siny = Math.min(Math.max(siny, -0.9999), 0.9999);
  return {
    x: TILE_SIZE * (0.5 + lon / 360),
    y: TILE_SIZE * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

app.listen(3000,async () =>{
    console.log("map server started");
    await client.connect();
    console.log("Postgres client connected");
})
