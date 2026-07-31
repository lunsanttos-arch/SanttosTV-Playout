const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");

const { initializeDatabase, addLog } = require("../database/database");


function createWindow() {

    const win = new BrowserWindow({

        width: 1400,
        height: 850,

        minWidth: 1000,
        minHeight: 600,

        backgroundColor: "#101010",

        webPreferences: {

            nodeIntegration: false,

            contextIsolation: true,

            preload: path.join(
                __dirname,
                "preload.js"
            )

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



   addLog(
    "Sistema iniciado"
);



    console.log(
        "Banco de dados OK"
    );


}


ipcMain.handle(
    "select-video",
    async ()=>{


        const result =
        await dialog.showOpenDialog({

            properties:[
                "openFile"
            ],

            filters:[

                {
                    name:"Vídeos",
                    extensions:[
                        "mp4",
                        "mov"
                    ]
                }

            ]

        });



        if(result.canceled){

            return null;

        }


        return result.filePaths[0];


    }
);

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
