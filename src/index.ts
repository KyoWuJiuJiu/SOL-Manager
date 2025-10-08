import $ from "jquery";
import "./index.scss";
import { bindUIEvents } from "./ui/bindEvents";

import { bitable } from "@lark-base-open/js-sdk";

(window as any).debugBitable = bitable;

$(function () {
  bindUIEvents();
});
