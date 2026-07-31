const fs = require("fs");
const path = require("path");


const databaseFolder = path.join(
    __dirname,
    "../../database"
);


if (!fs.existsSync(databaseFolder)) {

    fs.mkdirSync(databaseFolder);

}



const databaseFile = path.join(
    databaseFolder,
    "santtos-tv.json"
);



let data = {

    settings: {},

    media: [],

    playlist: [],

    logs: []

};



function save(){

    fs.writeFileSync(

        databaseFile,

        JSON.stringify(
            data,
            null,
            2
        )

    );

}



function initializeDatabase(){


    if(fs.existsSync(databaseFile)){

        data = JSON.parse(

            fs.readFileSync(
                databaseFile
            )

        );


    } else {


        save();


    }



    addLog(
        "Sistema iniciado"
    );


}



function addLog(message){


    data.logs.push({

        message: message,

        date: new Date()

    });



    save();


}



module.exports = {

    initializeDatabase,

    addLog,

    data

};
