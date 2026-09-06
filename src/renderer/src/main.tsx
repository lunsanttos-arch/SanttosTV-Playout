import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import "./styles.css";
import "./hashtag.css";

/*
    A biblioteca serve apenas como fonte de mídia.

    Um clique simples nela nunca deve trocar o conteúdo
    carregado no PROGRAM. O PROGRAM é controlado somente
    pela timeline.

    Mantemos botões, drag-and-drop e duplo clique funcionando.
*/
document.addEventListener(
    "click",
    (event) => {
        const target =
            event.target instanceof Element
                ? event.target
                : null;

        if (!target) {
            return;
        }

        const libraryItem = target.closest(
            ".playout-library-column .media-item"
        );

        if (!libraryItem) {
            return;
        }

        if (
            target.closest(
                "button, input, textarea, select, a"
            )
        ) {
            return;
        }

        event.stopPropagation();
    },
    true
);

const rootElement = document.getElementById("root");

if (!rootElement) {
    throw new Error(
        "Elemento raiz da interface não encontrado."
    );
}

ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
