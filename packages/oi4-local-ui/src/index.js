import React from 'react';
//import ReactDOM from 'react-dom';
import OI4Base from './OI4-UI/app.jsx';
//import * as serviceWorker from './serviceWorker';
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
//import App from "./OI4-UI/App";


//ReactDOM.render(<OI4Base />, document.getElementById('root'));

const rootElement = document.getElementById("root");
const root = createRoot(rootElement);

root.render(
    <StrictMode>
        <OI4Base />
    </StrictMode>
);

// If you want your app to work offline and load faster, you can change
// unregister() to register() below. Note this comes with some pitfalls.
// Learn more about service workers: https://bit.ly/CRA-PWA
//serviceWorker.unregister();
