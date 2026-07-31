const { app, BrowserWindow } = require("electron");
const path = require("path");

const { initializeDatabase, db } = require("../database/database");


function createWindow() {

    const win = new BrowserWindow({

        width: 1400,
        height: 850,

        minWidth: 1000,
        minHeight: 600,

        backgroundColor: "#101010",

        webPreferences: {

            nodeIntegration: false,

            contextIsolation: true

        },

        title: "Santtos TV Automation"

    });


    win.loadFile(

        path.join(
            __dirname,
            "../renderer/index.html"
        )

    );

}



function startSystem(){


    console.log(
        "Inicializando Santtos TV Automation..."
    );


    initializeDatabase();



    db.prepare(`

        INSERT INTO logs(message)

        VALUES(?)

    `)

    .run(
        "Sistema iniciado"
    );



    console.log(
        "Banco de dados OK"
    );


}




app.whenReady().then(()=>{


    startSystem();


    createWindow();



    app.on(
        "activate",
        ()=>{

            if(
                BrowserWindow
                .getAllWindows()
                .length === 0
            ){

                createWindow();

            }

        }
    );


});





app.on(
    "window-all-closed",
    ()=>{

        if(
            process.platform !== "darwin"
        ){

            app.quit();

        }

    }
);
