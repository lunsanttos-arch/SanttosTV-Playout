const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");


const databaseFolder = path.join(
    __dirname,
    "../../database"
);


if (!fs.existsSync(databaseFolder)) {
    fs.mkdirSync(databaseFolder);
}


const dbPath = path.join(
    databaseFolder,
    "santtos-tv.db"
);



const db = new Database(dbPath);



function initializeDatabase(){


    db.prepare(`
        CREATE TABLE IF NOT EXISTS settings (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            key TEXT UNIQUE,

            value TEXT

        )
    `).run();



    db.prepare(`
        CREATE TABLE IF NOT EXISTS media (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT,

            path TEXT,

            duration TEXT,

            resolution TEXT,

            fps TEXT,

            codec TEXT,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP

        )
    `).run();




    db.prepare(`
        CREATE TABLE IF NOT EXISTS playlist (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            media_id INTEGER,

            start_time TEXT,

            order_position INTEGER,

            FOREIGN KEY(media_id)

            REFERENCES media(id)

        )
    `).run();





    db.prepare(`
        CREATE TABLE IF NOT EXISTS logs (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            message TEXT,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP

        )
    `).run();


}



module.exports = {

    db,

    initializeDatabase

};
