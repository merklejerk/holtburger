import "./styles.css";
import App from "./App.svelte";

const target = document.getElementById("app");

if (target === null) {
	throw new Error("Missing #app mount target.");
}

new App({ target });
