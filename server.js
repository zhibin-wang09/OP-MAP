const express = require('express');
const leafleft = require('leaflet');
const {client} = require('pg');
const client = new Client({
    host: 'localhost',
    port : '5334',
    database: 'gis',
    user :'renderer',
    password :'renderer'
});

const app = express();

app.post("/api/search", async (req,res)=>{
    const {minLat, minLon, maxLat, maxLon} = req.body.bbox;
    const search_string = req.body.searchTerm;
    const onlyInBox = req.body.onlyInBox;
    const query = {
        text: `
          SELECT
            id,
            lon AS longitude,
            lat AS latitude
          FROM
            planet_osm_nodes
          WHERE
            lat BETWEEN $1 AND $2
            AND lon BETWEEN $3 AND $4
        `,
        values: [minLat, maxLat, minLon, maxLon]
    }
    let result = await client.query(query);
    console.log(result);

    
})

app.listen(80, "0.0.0.0", async () =>{
    console.log("map server started");
    await client.connect();
    console.log("Postgres client connected");
})
