function updateClock(){

    const now = new Date();


    const time =
        now.toLocaleTimeString(
            "pt-BR"
        );


    document
    .getElementById("clock")
    .innerHTML = time;

}



setInterval(
    updateClock,
    1000
);


updateClock();
