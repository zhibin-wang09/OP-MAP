const express = require("express");
const zlib = require('zlib');
const { Client } = require("pg");
const fetch = require("node-fetch");
const { MongoClient } = require("mongodb");
var rand = require("random-key");
var nodemailer = require("nodemailer");
var session = require('express-session');
const ip_address = "209.94.58.38";
const uri = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000&appName=mongosh+2.2.5";
const mongoClient = new MongoClient(uri); // creates the client to interact with the mongodb database
let is_login = false;
const CSE356ID = '65e148778849cf2582029a74';
const transporter = nodemailer.createTransport({
	host: ip_address,
	service: "postfix",
	port: 25,
	secure: false,
	tls: {
		rejectUnauthorized: false,
	},
});

const client = new Client({
	host: "localhost",
	port: "5432",
	database: "gis",
	user: "renderer",
	password: "renderer",
});

const app = express();
app.use(express.json());
app.use(session({ secret: 'keyboard cat', cookie: { maxAge: 600000 }, resave: false, saveUninitialized:true}));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
	console.log(req.url, req.body);
	next();
});

app.post("/api/search", async (req, res) => {
  const { bbox, onlyInBox, searchTerm } = req.body;
  const { minLat, minLon, maxLat, maxLon } = bbox;

  let selectClause = onlyInBox
    ? `SELECT DISTINCT name, ST_AsGeoJSON(ST_Transform(ST_Centroid(ST_Intersection(sub.way, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326))),4326)) AS coordinates, ST_AsGeoJSON(ST_Transform(ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)),4326)) AS bbox`
    : `SELECT DISTINCT name, ST_AsGeoJSON(ST_Transform(ST_Centroid(sub.way),4326)) AS coordinates, ST_AsGeoJSON(ST_Transform(ST_Envelope(sub.way),4326)) AS bbox`;

  let sqlQuery = `${selectClause}
    FROM (
      SELECT DISTINCT name, way FROM planet_osm_point WHERE name LIKE $1
      UNION ALL
      SELECT DISTINCT name, way FROM planet_osm_line WHERE name LIKE $1
      UNION ALL
      SELECT DISTINCT name, way FROM planet_osm_polygon WHERE name LIKE $1
    ) AS sub`;

  if (onlyInBox) {
    sqlQuery += ` WHERE sub.way && ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`;
  }
  sqlQuery+=`\nLIMIT 30`

  try {
    const result = await client.query(sqlQuery, [`%${searchTerm}%`]); // Parameterized query to prevent SQL injection
    const formattedResults = result.rows.map((row) => {
      // Parse GeoJSON safely
      	const coordinatesGeoJSON = JSON.parse(row.coordinates);
    	const bboxGeoJSON = JSON.parse(row.bbox);
		var lat=null;
		var lon=null;
		var minLat=null;
		var minLon=null;
		var maxLat=null;
		var maxLon=null;


		lon=coordinatesGeoJSON.coordinates[0];
		lat=coordinatesGeoJSON.coordinates[1];
		if(bboxGeoJSON.type=="Point"){
			maxLon=bboxGeoJSON.coordinates[0];
			minLon=bboxGeoJSON.coordinates[0];
			maxLat=bboxGeoJSON.coordinates[1];
			minLat=bboxGeoJSON.coordinates[1];
		}
		else if(bboxGeoJSON.type=="Polygon"){
			maxLon=Math.max(
				bboxGeoJSON.coordinates[0][0][0],
				bboxGeoJSON.coordinates[0][1][0],
				bboxGeoJSON.coordinates[0][2][0],
				bboxGeoJSON.coordinates[0][3][0],
			);
			minLon=Math.min(
				bboxGeoJSON.coordinates[0][0][0],
				bboxGeoJSON.coordinates[0][1][0],
				bboxGeoJSON.coordinates[0][2][0],
				bboxGeoJSON.coordinates[0][3][0],
			);
			maxLat=Math.max(
				bboxGeoJSON.coordinates[0][0][1],
				bboxGeoJSON.coordinates[0][1][1],
				bboxGeoJSON.coordinates[0][2][1],
				bboxGeoJSON.coordinates[0][3][1],
			);
			minLat=Math.min(
				bboxGeoJSON.coordinates[0][0][1],
				bboxGeoJSON.coordinates[0][1][1],
				bboxGeoJSON.coordinates[0][2][1],
				bboxGeoJSON.coordinates[0][3][1],
			);
		}
		console.log({
			name:row.name,
			coordinates: {
				lat: lat,
				lon: lon
			},
			bbox: {
				minLat: minLat,
				minLon: minLon,
				maxLat: maxLat,
				maxLon: maxLon
			},
		})
	  
    	return {
			name:row.name,
			coordinates: {
				lat: lat,
				lon: lon
			},
			bbox: {
				minLat: minLat,
				minLon: minLon,
				maxLat: maxLat,
				maxLon: maxLon
			},
		};
    });
    res.set("X-CSE356", CSE356ID);
    res.status(200).json(formattedResults);
  } catch (error) {
    console.error("Error executing query:", error.stack);
    res.set("X-CSE356", CSE356ID);
    res.status(500).send("Error executing query");
  }
});

app.get("/tiles/:z/:x/:y.png", async (req, res) => {
	try {
		const tileResponse = await fetch(
			`http://127.0.0.1:8080/tile/${req.params.z}/${req.params.x}/${req.params.y}.png`
		);
		const tileBuffer = await tileResponse.buffer();

		// Log the tile response
		console.log(
			`Tile response for ${req.params.z}/${req.params.x}/${req.params.y}.png:`,
			tileResponse
		);

		res.set("X-CSE356", "65e148778849cf2582029a74");
		res.status(200).type("image/png").send(tileBuffer);
	} catch (error) {
		console.error(error);
		res.set("X-CSE356", "65e148778849cf2582029a74");
		res.status(500).json({ error: "Internal Server Error" });
	}
});

prev=null;

app.post("/convert", (req, res) => {
        var { zoom, lat, long } = req.body;

		lat=40.754932;
		long=-73.984016;

        const latRad = (lat * Math.PI) / 180;
        const n = Math.pow(2, zoom);
        const xtile = Math.floor(n * ((long + 180) / 360)); //  'long' to 'lon'
        const ytile = Math.floor(
            ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
        );

        const tileCoordinate = {
                x_tile: xtile,
                y_tile: ytile,
        };
        console.log("Converted x,y",xtile,ytile)
	res.set("X-CSE356", "65e148778849cf2582029a74");
	res.status(200).json(tileCoordinate);
});

function encodePlus(url) {
	return url.replace(/ /g, "+");
}


app.post("/api/address", async (req, res) => {
	const { lat, lon } = req.body;
  
	try {
	  const result = await client.query(`
		SELECT tags
		FROM (
		  SELECT osm_id, way FROM planet_osm_point
		  WHERE ST_DWithin(way, ST_SetSRID(ST_MakePoint($1, $2), 4326), 0.0001)
		  UNION ALL
		  SELECT osm_id, way FROM planet_osm_roads
		  WHERE ST_DWithin(way, ST_SetSRID(ST_MakePoint($1, $2), 4326), 0.0001)
		  UNION ALL
		  SELECT osm_id, way FROM planet_osm_polygon
		  WHERE ST_DWithin(way, ST_SetSRID(ST_MakePoint($1, $2), 4326), 0.0001)
		) AS nearby
		JOIN planet_osm_point ON nearby.osm_id = planet_osm_point.osm_id
		LIMIT 1;
	  `, [lon, lat]);
  
	  if (result.rows.length === 0) {
		res.set("X-CSE356", CSE356ID);
		return res.status(404).json({ error: "Address not found" });
	  }
  
	  const tags = result.rows[0].tags;
	  const address = {
		number: tags.addr_housenumber || "",
		street: tags.addr_street || "",
		city: tags.addr_city || "",
		state: tags.addr_state || "",
		country: tags.addr_country || "",
	  };
  
	  res.set("X-CSE356", CSE356ID);
	  res.status(200).json(address);
	} catch (error) {
	  console.error("Error executing query:", error);
	  res.set("X-CSE356", CSE356ID);
	  res.status(500).json({ error: "Internal Server Error" });
	}
  });

app.get("/test", function (req, res) {
	console.log("test");
	res.status(200).send("hello world");
});

// this should create the user and send a verification email to the user
app.post("/api/adduser", async function (req, res) {
	console.log("adduser");
	const username = req.body.username;
	const password = req.body.password;
	const email = encodePlus(req.body.email);
	console.log(email);
	const collection = mongoClient.db("birdinspace").collection("account");
	const query = { username: username, email: email };
	if (await collection.findOne(query)) {
		res.set("X-CSE356", CSE356ID);
		return res
			.status(200)
			.json({ Error: "user already created", status: "ERROR" });
	}
	const key = rand.generate();
	const document = {
		username: username,
		password: password,
		email: email,
		isVerify: false,
		key: key,
	};
	const result = await collection.insertOne(document);

	const verifyLink = `http://${ip_address}/api/verify?email=${email}&key=${key}`;
	let mailOption = {
		from: "root@cse356.compas.cs.stonybrook.edu",
		to: email,
		subject: "CSE356 Verification",
		text: `Click the link to verify your account :), ${verifyLink}`,
	};
	transporter.sendMail(mailOption, (err, info) => {
		if (err) {
			console.log("error sending email:", err);
		} else {
			console.log("success sending email:", info);
		}
	});
	res.set("X-CSE356", CSE356ID);
	res.status(200).json({ result: result, status: "ok" });
});

app.get("/api/verify", async function (req, res) {
	console.log("verify");
	const email = encodePlus(req.query.email);
	const key = req.query.key;
	const document = { email: email, key: key };
	const collection = mongoClient.db("birdinspace").collection("account");
	const result = await collection.findOne(document);
	res.set("X-CSE356", CSE356ID);
	if (result) {
		await collection.updateOne(
			{ email: email, key: key },
			{ $set: { isVerify: true } }
		);
		return res.status(200).json({ status: "ok" });
	} else {
		return res.status(200).json({ status: "ERROR" });
	}
});

app.post("/api/login", async function (req, res) {
	console.log("login");
	const username = req.body.username;
	const password = req.body.password;

	const document = { username: username, password: password };
	const collection = mongoClient.db("birdinspace").collection("account");
	const result = await collection.findOne(document);
	res.set("X-CSE356", CSE356ID);

	is_login = true;
	if (result && result.isVerify) {
		req.session.username = username;
		return res.status(200).json({ status: "ok" });
	} else {
		return res.status(200).json({ status: "ERROR" });
	}
});

app.post("/api/logout", async function (req, res) {
	console.log("logout");

	res.set("X-CSE356", CSE356ID);
	is_login = false;
	if (req.session.username) {
		req.session.username = null;
		return res.status(200).json({ status: "ok" });
	} else {
		return res.status(200).json({ status: "ERROR" });
	}
});

app.get("/api/user", async function(req,res){
	console.log("GET user");
	const username = req.session.username;
	const document = { username: username};
	const collection = mongoClient.db("birdinspace").collection("account");
	const result = await collection.findOne(document);
	res.set("X-CSE356", CSE356ID);
	if(username){
		return res.status(200).json({loggedin: true, username : username});
	}else{
		return res.status(200).json({loggedin: false});
	}

});

app.post('/api/route', async function(req,res){
	if(!is_login) return res.status(200).json({status: "ERROR"});
	const source_lat = req.body.source.lat;	
	const source_lon = req.body.source.lon;	
	const destination_lat = req.body.destination.lat;	
	const destination_lon = req.body.destination.lon;	

	const routeResponse = await fetch(
		`http://209.151.152.200:8989/route?point=${source_lat},${source_lon}&point=${destination_lat},${destination_lon}&profile=car&points_encoded=false`);
	const result = await routeResponse.json();
	//console.log(JSON.stringify(result,null,4));
	const coordinates = result.paths[0].points.coordinates; // the lat and lon for the roads in instruction
	const instructions = result.paths[0].instructions; // the list of roads to take to get the destination
	const route = [];
	instructions.map((road) => {
		route.push({
			"description": road.street_name,
			"distance": road.distance,
			"coordinates": {
				"lat": coordinates[road.interval[0]][0],
				"lon": coordinates[road.interval[0]][1],
			}
		})
	})
	console.log(route);
	res.set("X-CSE356", CSE356ID);
	return res.status(200).json(route);
})

app.get('/turn/:tl/:br.png', async (req, res) => {
	try {
	  const [tlLon,tlLat] = req.params.tl.split(',');
	  console.log(`[tlLat, tlLon] ${tlLat,tlLon}`)
	  const [brLon,brLat] = req.params.br.split(',');
	  console.log(`[brLat, brLon] ${brLat, brLon}`)
  
	  // Calculate the center coordinates
	  const centerLat = (parseFloat(tlLat) + parseFloat(brLat)) / 2;
	  const centerLon = (parseFloat(tlLon) + parseFloat(brLon)) / 2;
	  console.log(`[centerLat, centerLon] ${centerLat,centerLon}`)
  
	  // Adjust the zoom level based on the distance between the coordinates
	  const latDiff = Math.abs(parseFloat(tlLat) - parseFloat(brLat));
	  const lonDiff = Math.abs(parseFloat(tlLon) - parseFloat(brLon));
	  const maxDiff = Math.max(latDiff, lonDiff);
	  const zoom = Math.floor(Math.log2(360 / maxDiff)) - 2;
	  console.log(`[latDiff, lonDiff, maxDiff, zoom]`,latDiff, lonDiff, maxDiff, zoom)
  
	  // Convert the center coordinates to tile coordinates
	  const centerTile = latLonToTile(centerLat, centerLon, zoom);
	  console.log(`[centertile] `,centerTile)
  
	  // Calculate the bounding box for the tile
	  const tileSize = 256;
	  const tileBounds = tileToLatLonBounds(centerTile.x, centerTile.y, zoom);
  
	  // Calculate the pixel coordinates of the top-left and bottom-right points within the tile
	  const tlPixel = latLonToPixel(parseFloat(tlLat), parseFloat(tlLon), zoom);
	  const brPixel = latLonToPixel(parseFloat(brLat), parseFloat(brLon), zoom);
	  console.log(`[tlPixel,brPixel] `,tlPixel,brPixel)
  
	  // Calculate the relative pixel coordinates within the tile
	  const tlRelativePixel = {
		x: tlPixel.x - centerTile.x * tileSize,
		y: tlPixel.y - centerTile.y * tileSize,
	  };
	  const brRelativePixel = {
		x: brPixel.x - centerTile.x * tileSize,
		y: brPixel.y - centerTile.y * tileSize,
	  };
	  console.log(`[tlRelativePixel,brRelativePixel] `,tlRelativePixel,brRelativePixel)
  
	  // Fetch the tile image
	  const tileResponse = await fetch(`http://127.0.0.1:8080/tile/${zoom}/${centerTile.x}/${centerTile.y}.png`);
	  const tileBuffer = await tileResponse.arrayBuffer();
  
	  // Create a sharp instance with the tile image buffer
	  const sharp = require('sharp');
	  const image = sharp(Buffer.from(tileBuffer));
  
	  // Extract the desired portion of the tile image
	  const extractedImage = await image
		.resize(100, 100)
		.toBuffer();
  
	  res.set('Content-Type', 'image/png');
	  res.set('X-CSE356', CSE356ID);
	  res.status(200);
	  res.send(extractedImage);
	} catch (error) {
	  console.error('Error fetching tile image:', error);
	  res.set('X-CSE356', CSE356ID);
	  res.status(500).send('Error fetching tile image');
	}
  });
  
  // Helper functions
  
  function latLonToTile(lat, lon, zoom) {
	const latRad = (lat * Math.PI) / 180;
	const n = Math.pow(2, zoom);
	const x = Math.floor(((lon + 180) / 360) * n);
	const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
	return { x, y };
  }
  
  function tileToLatLonBounds(x, y, zoom) {
	const n = Math.pow(2, zoom);
	const lonLeft = (x / n) * 360 - 180;
	const latTop = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
	const lonRight = ((x + 1) / n) * 360 - 180;
	const latBottom = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 1) / n))) * 180 / Math.PI;
	return { minLat: latBottom, minLon: lonLeft, maxLat: latTop, maxLon: lonRight };
  }
  
  function latLonToPixel(lat, lon, zoom) {
	const tileSize = 256;
	const latRad = (lat * Math.PI) / 180;
	const n = Math.pow(2, zoom);
	const x = Math.floor(((lon + 180) / 360) * n * tileSize);
	const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n * tileSize);
	return { x, y };
  }


app.get("/", (req, res) => {
	res.set("X-CSE356", "65e148778849cf2582029a74");
	res.status(200).json({ status: "ok" });
});

app.listen(80, "0.0.0.0", async () => {
	console.log("map server started");
	await client.connect();
	await mongoClient.connect();
	console.log("Postgres client connected");
	console.log("Mongodb client connected");
});
