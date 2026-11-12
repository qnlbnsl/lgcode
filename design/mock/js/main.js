// Starts the mock in this folder's own page. A page that loads the mock as a package
// imports mount() from app.js and calls it itself.
import { mount } from './app.js';

window.lgtm = mount(document.getElementById('app')); // for poking at the mock from the console
