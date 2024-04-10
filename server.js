const express = require("express");
const zlib = require('zlib');
const { Client } = require("pg");
const fetch = require("node-fetch");
const { MongoClient } = require("mongodb");
var rand = require("random-key");
var nodemailer = require("nodemailer");
var session = require('express-session');
const ip_address = "194.113.75.144";
const uri = "mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000&appName=mongosh+2.2.3";
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
		? `SELECT name, ST_AsGeoJSON(ST_Centroid(ST_Intersection(way, ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${minLat}, 4326)))) AS coordinates, ST_AsGeoJSON(ST_Envelope(way)) AS bbox`
		: `SELECT name, ST_AsGeoJSON(ST_Centroid(way)) AS coordinates, ST_AsGeoJSON(ST_Envelope(way)) AS bbox`;

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
		const formattedResults = result.rows.map((row) => {
			// Parse GeoJSON safely
			const coordinatesGeoJSON = JSON.parse(row.coordinates);
			const bboxGeoJSON = JSON.parse(row.bbox);

			let lat,
				lon,
				minLat = Infinity,
				maxLat = -Infinity,
				minLon = Infinity,
				maxLon = -Infinity;

			// Extract coordinates for 'Point'
			if (coordinatesGeoJSON.type === "Point") {
				[lon, lat] = coordinatesGeoJSON.coordinates;
			}

			// Assuming bbox is a 'Polygon' and extracting its bounds
			if (
				bboxGeoJSON.type === "Polygon" &&
				bboxGeoJSON.coordinates.length > 0
			) {
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
				coordinates:
				lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
				bbox: isFinite(minLat) ? { minLat, minLon, maxLat, maxLon } : undefined,
			};
		});
		res.set("X-CSE356", "65e148778849cf2582029a74");
		res.status(200).json(formattedResults);
	} catch (error) {
		console.error("Error executing query:", error.stack);
		res.set("X-CSE356", "65e148778849cf2582029a74");
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

app.post("/convert", (req, res) => {
	const { zoom, lat, long } = req.body; //  'long' to 'lon'

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

	res.set("X-CSE356", "65e148778849cf2582029a74");
	res.status(200).json(tileCoordinate);
});

function encodePlus(url) {
	return url.replace(/ /g, "+");
}

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
	if(username){
		return res.status(200).json({loggedin: true, username : username});
	}else{
		return res.status(200).json({loggedin: false});
	}

});

app.post('/api/route', async function(req,res){
	const source_lat = req.body.source.lat;	
	const source_lon = req.body.source.lon;	
	const destination_lat = req.body.destination.lat;	
	const destination_lon = req.body.destination.lon;	

	const routeResponse = await fetch(
		`http://194.113.75.144:8989/route?point=${source_lat},${source_lon}&point=${destination_lat},${destination_lon}&profile=car&points_encoded=false`);
	const result = await routeResponse.json();
	console.log(JSON.stringify(result,null,4));

	res.status(200).json({status:'ok'});
})

app.get("/", (req, res) => {
	res.set("X-CSE356", "65e148778849cf2582029a74");
	res.status(200).json({ status: "ok" });
});

app.listen(3000, "0.0.0.0", async () => {
	console.log("map server started");
	await client.connect();
	await mongoClient.connect();
	console.log("Postgres client connected");
	console.log("Mongodb client connected");
});
