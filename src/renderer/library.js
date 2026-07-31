const button = document.getElementById(
    "add-media"
);


button.addEventListener(
    "click",
    async ()=>{

        const video =
        await window.electronAPI.selectVideo();


        if(video){

            alert(
                "Vídeo selecionado:\n\n" + video
            );

        }

    }
);
