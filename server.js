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
app.use((req,res,next) => {
	console.log(req.url,req.body);
	next();
});
// the following query does this
// Given bounding box with minLat, minLon, maxLat, maxLon we are going to search objects in the table
// called planet_osm_point, planet_osm_roads, planet_osm_line, planet_osm_polygon if the boolean value
// 'onlyInBox' is true otherwise we search the whole map. Each record in the previous four tables contains
// an attribute call osm_id and this id is used to match the id in planet_osm_node table to get the coordinate.
// Then the query result across the 4 tables are joined
// aand sorted base on its distance from the center of the bounding box.
// app.post("/api/search", async (req, res) => {
	
// 	const { minLat, minLon, maxLat, maxLon } = req.body.bbox;
// 	const onlyInBox = req.body.onlyInBox;
// 	const searchTerm = req.body.searchTerm;

// 	const queryText = `
//     SELECT
//       name,
//       osm_id,
//       type,
//       ST_AsGeoJSON(bbox)::json AS bbox
//     FROM (
//       SELECT
// 	name,
// 	osm_id,
// 	'line' AS type,
// 	ST_Envelope(way) AS bbox
//       FROM planet_osm_line
//       WHERE name ILIKE $1
// 	AND (NOT $6 OR ST_Intersects(way, ST_MakeEnvelope($2, $3, $4, $5, 4326)))

//       UNION ALL

//       SELECT
// 	name,
// 	osm_id,
// 	'road' AS type,
// 	ST_Envelope(way) AS bbox
//       FROM planet_osm_roads
//       WHERE name ILIKE $1
// 	AND (NOT $6 OR ST_Intersects(way, ST_MakeEnvelope($2, $3, $4, $5, 4326)))

//       UNION ALL

//       SELECT
// 	name,
// 	osm_id,
// 	'polygon' AS type,
// 	ST_Envelope(way) AS bbox
//       FROM planet_osm_polygon
//       WHERE name ILIKE $1
// 	AND (NOT $6 OR ST_Intersects(way, ST_MakeEnvelope($2, $3, $4, $5, 4326)))

//       UNION ALL

//       SELECT
// 	name,
// 	osm_id,
// 	'point' AS type,
// 	ST_Envelope(way) AS bbox
//       FROM planet_osm_point
//       WHERE name ILIKE $1
// 	AND (NOT $6 OR ST_Intersects(way, ST_MakeEnvelope($2, $3, $4, $5, 4326)))
//     ) AS results
//     ORDER BY name;
//   `;

// 	const queryValues = [`%${searchTerm}%`, minLon, minLat, maxLon, maxLat, onlyInBox];

// 	try {
// 		console.log("Executing search query with values:", queryValues);
// 		const result = await client.query(queryText, queryValues);
// 		console.log("Search query result:", result);
	  
// 		if (result.rows && result.rows.length) {
// 		  res.set('X-CSE356', '65e148778849cf2582029a74');
// 		  res.status(200).json(result.rows);
// 		} else {
// 		  res.set('X-CSE356', '65e148778849cf2582029a74');
// 		  res.status(404).json({ message: "No matching records found." });
// 		}
// 	  } catch (error) {
// 		console.error("Error executing search query:", error);
// 		res.set('X-CSE356', '65e148778849cf2582029a74');
// 		res.status(500).json({ error: "An error occurred during the search." });
// 	  }
// });

app.post("/api/search", async (req, res) => {
  const { bbox, onlyInBox, searchTerm } = req.body;
  const { minLat, minLon, maxLat, maxLon } = bbox;

  let selectClause = onlyInBox ?
    `SELECT name, ST_AsGeoJSON(ST_Centroid(ST_Intersection(way, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${minLat}, 4326)))) AS coordinates, ST_AsGeoJSON(ST_Envelope(way)) AS bbox` :
    `SELECT name, ST_AsGeoJSON(ST_Centroid(way)) AS coordinates, ST_AsGeoJSON(ST_Envelope(way)) AS bbox`;

  let sqlQuery = `${selectClause}
  FROM (
    SELECT name, way FROM planet_osm_point WHERE name ILIKE $1
    UNION ALL
    SELECT name, way FROM planet_osm_roads WHERE name ILIKE $1
    UNION ALL
    SELECT name, way FROM planet_osm_line WHERE name ILIKE $1
    UNION ALL
    SELECT name, way FROM planet_osm_polygon WHERE name ILIKE $1
  ) AS sub`;

  if (onlyInBox) {
    sqlQuery += ` WHERE sub.way && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`;
  }

  try {
    const result = await client.query(sqlQuery, [`%${searchTerm}%`]); // Parameterized query to prevent SQL injection
    const formattedResults = result.rows.map(row => {
      // Parse GeoJSON safely
      const coordinatesGeoJSON = JSON.parse(row.coordinates);
      const bboxGeoJSON = JSON.parse(row.bbox);

      let lat, lon, minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
      
      // Extract coordinates for 'Point'
      if (coordinatesGeoJSON.type === 'Point') {
        [lon, lat] = coordinatesGeoJSON.coordinates;
      }

      // Assuming bbox is a 'Polygon' and extracting its bounds
      if (bboxGeoJSON.type === 'Polygon' && bboxGeoJSON.coordinates.length > 0) {
        for (let coord of bboxGeoJSON.coordinates[0]) {
          const [longitude, latitude] = coord;
          minLat = Math.min(minLat, latitude);
          maxLat = Math.max(maxLat, latitude);
          minLon = Math.min(minLon, longitude);
          maxLon = Math.max(maxLon, longitude);
        }
      }

      return {
        name: row.name,
        coordinates: lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
        bbox: isFinite(minLat) ? { minLat, minLon, maxLat, maxLon } : undefined,
      };
    });
    res.set('X-CSE356', '65e148778849cf2582029a74');
    res.status(200).json(formattedResults);
  } catch (error) {
    console.error('Error executing query:', error.stack);
    res.set('X-CSE356', '65e148778849cf2582029a74');
    res.status(500).send('Error executing query');
  }
});


app.get('/tiles/:z/:x/:y.png', async (req, res) => {
	try {
	  const tileResponse = await fetch(`http://127.0.0.1:8080/tile/${req.params.z}/${req.params.x}/${req.params.y}.png`);
	  const tileBuffer = await tileResponse.buffer();
  
	  // Log the tile response
	  console.log(`Tile response for ${req.params.z}/${req.params.x}/${req.params.y}.png:`, tileResponse);
  
	  res.set('X-CSE356', '65e148778849cf2582029a74');
	  res.status(200).type('image/png').send(tileBuffer);
	} catch (error) {
	  console.error(error);
	  res.set('X-CSE356', '65e148778849cf2582029a74');
	  res.status(500).json({ error: 'Internal Server Error' });
	}
  });

const TILE_SIZE = 256;

app.post('/convert', (req, res) => {
    const { zoom, lat, long } = req.body; //  'long' to 'lon'

    const latRad = (lat * Math.PI) / 180;
    const n = Math.pow(2, zoom);
    const xtile = Math.floor(n * ((long + 180) / 360)); //  'long' to 'lon'
    const ytile = Math.floor(
        (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n
    );

    const tileCoordinate = {
        x_tile: xtile,
        y_tile: ytile
    };

    res.set('X-CSE356', '65e148778849cf2582029a74');
    res.status(200).json(tileCoordinate);
});



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

app.get("/",(req,res)=>{
	
	res.set('X-CSE356', '65e148778849cf2582029a74')
	res.status(200).json({status:'ok'});
});

app.listen(3000,'0.0.0.0',async () =>{
	console.log("map server started");
	await client.connect();
	console.log("Postgres client connected");
})
