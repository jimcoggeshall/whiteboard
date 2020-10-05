import keymage from "keymage";
import io from "socket.io-client";
import whiteboard from "./whiteboard";
import keybinds from "./keybinds";
import Picker from "vanilla-picker";
import { dom } from "@fortawesome/fontawesome-svg-core";
import pdfjsLib from "pdfjs-dist/webpack";
import shortcutFunctions from "./shortcutFunctions";
import ReadOnlyService from "./services/ReadOnlyService";
import InfoService from "./services/InfoService";
import { getSubDir } from "./utils";
import ConfigService from "./services/ConfigService";
import { v4 as uuidv4 } from "uuid";

const urlParams = new URLSearchParams(window.location.search);
let whiteboardId = urlParams.get("whiteboardid");
const randomid = urlParams.get("randomid");

if (randomid) {
    whiteboardId = uuidv4();
    urlParams.delete("randomid");
    window.location.search = urlParams;
}

if (!whiteboardId) {
    whiteboardId = "myNewWhiteboard";
}

whiteboardId = unescape(encodeURIComponent(whiteboardId)).replace(/[^a-zA-Z0-9\-]/g, "");

if (urlParams.get("whiteboardid") !== whiteboardId) {
    urlParams.set("whiteboardid", whiteboardId);
    window.location.search = urlParams;
}

const myUsername = urlParams.get("username") || "unknown" + (Math.random() + "").substring(2, 6);
const accessToken = urlParams.get("accesstoken") || "";

// Custom Html Title
const title = urlParams.get("title");
if (title) {
    document.title = decodeURIComponent(title);
}

const subdir = getSubDir();
let signaling_socket;

function main() {
    signaling_socket = io("", { path: subdir + "/ws-api" }); // Connect even if we are in a subdir behind a reverse proxy

    signaling_socket.on("connect", function () {
        console.log("Websocket connected!");

        signaling_socket.on("whiteboardConfig", (serverResponse) => {
            ConfigService.initFromServer(serverResponse);
            // Inti whiteboard only when we have the config from the server
            initWhiteboard();
        });

        signaling_socket.on("whiteboardInfoUpdate", (info) => {
            InfoService.updateInfoFromServer(info);
            whiteboard.updateSmallestScreenResolution();
        });

        signaling_socket.on("drawToWhiteboard", function (content) {
            whiteboard.handleEventsAndData(content, true);
            InfoService.incrementNbMessagesReceived();
        });

        signaling_socket.on("refreshUserBadges", function () {
            whiteboard.refreshUserBadges();
        });

        let accessDenied = false;
        signaling_socket.on("wrongAccessToken", function () {
            if (!accessDenied) {
                accessDenied = true;
                showBasicAlert("Access denied! Wrong accessToken!");
            }
        });

        signaling_socket.emit("joinWhiteboard", {
            wid: whiteboardId,
            at: accessToken,
            windowWidthHeight: { w: $(window).width(), h: $(window).height() },
        });
    });
}

function showBasicAlert(html, newOptions) {
    var options = {
        header: "INFO MESSAGE",
        okBtnText: "Ok",
        headercolor: "#d25d5d",
        hideAfter: false,
        onOkClick: false,
    };
    if (newOptions) {
        for (var i in newOptions) {
            options[i] = newOptions[i];
        }
    }
    var alertHtml = $(
        '<div class="basicalert" style="position:absolute; left:0px; width:100%; top:70px; font-family: monospace;">' +
            '<div style="width: 30%; margin: auto; background: #aaaaaa; border-radius: 5px; font-size: 1.2em; border: 1px solid gray;">' +
            '<div style="border-bottom: 1px solid #676767; background: ' +
            options["headercolor"] +
            '; padding-left: 5px; font-size: 0.8em;">' +
            options["header"] +
            '<div style="float: right; margin-right: 4px; color: #373737; cursor: pointer;" class="closeAlert">x</div></div>' +
            '<div style="padding: 10px;" class="htmlcontent"></div>' +
            '<div style="height: 20px; padding: 10px;"><button class="modalBtn okbtn" style="float: right;">' +
            options["okBtnText"] +
            "</button></div>" +
            "</div>" +
            "</div>"
    );
    alertHtml.find(".htmlcontent").append(html);
    $("body").append(alertHtml);
    alertHtml
        .find(".okbtn")
        .off("click")
        .click(function () {
            if (options.onOkClick) {
                options.onOkClick();
            }
            alertHtml.remove();
        });
    alertHtml
        .find(".closeAlert")
        .off("click")
        .click(function () {
            alertHtml.remove();
        });

    if (options.hideAfter) {
        setTimeout(function () {
            alertHtml.find(".okbtn").click();
        }, 1000 * options.hideAfter);
    }
}

function initWhiteboard() {
    $(document).ready(function () {

        whiteboard.loadWhiteboard("#whiteboardContainer", {
            //Load the whiteboard
            whiteboardId: whiteboardId,
            username: btoa(myUsername),
            backgroundGridUrl: "./images/" + ConfigService.backgroundGridImage,
            sendFunction: function (content) {
                if (ReadOnlyService.readOnlyActive) return;
                //ADD IN LATER THROUGH CONFIG
                // if (content.t === 'cursor') {
                //     if (whiteboard.drawFlag) return;
                // }
                content["at"] = accessToken;
                signaling_socket.emit("drawToWhiteboard", content);
                InfoService.incrementNbMessagesSent();
            },
        });

        // request whiteboard from server
        $.get(subdir + "/api/loadwhiteboard", { wid: whiteboardId, at: accessToken }).done(
            function (data) {
                whiteboard.loadData(data);
            }
        );

        $(window).resize(function () {
            signaling_socket.emit("updateScreenResolution", {
                at: accessToken,
                windowWidthHeight: { w: $(window).width(), h: $(window).height() },
            });
        });

        /*----------------/
        Whiteboard actions
        /----------------*/

        var tempLineTool = false;
        var strgPressed = false;

        // whiteboard clear button
        $("#whiteboardTrashBtn")
            .off("click")
            .click(function () {
                $("#whiteboardTrashBtnConfirm").show().focus();
                $(this).css({ visibility: "hidden" });
            });

        $("#whiteboardTrashBtnConfirm").mouseout(function () {
            $(this).hide();
            $("#whiteboardTrashBtn").css({ visibility: "inherit" });
        });

        $("#whiteboardTrashBtnConfirm")
            .off("click")
            .click(function () {
                $(this).hide();
                $("#whiteboardTrashBtn").css({ visibility: "inherit" });
                whiteboard.clearWhiteboard();
            });

        // undo button
        $("#whiteboardUndoBtn")
            .off("click")
            .click(function () {
                whiteboard.undoWhiteboardClick();
            });

        // redo button
        $("#whiteboardRedoBtn")
            .off("click")
            .click(function () {
                whiteboard.redoWhiteboardClick();
            });

        // switch tool
        $(".whiteboard-tool")
            .off("click")
            .click(function () {
                $(".whiteboard-tool").removeClass("active");
                $(this).addClass("active");
                var activeTool = $(this).attr("tool");
                whiteboard.setTool(activeTool);
                if (activeTool == "mouse" || activeTool == "recSelect") {
                    $(".activeToolIcon").empty();
                } else {
                    $(".activeToolIcon").html($(this).html()); //Set Active icon the same as the button icon
                }
            });

        // upload image button
        $("#addImgToCanvasBtn")
            .off("click")
            .click(function () {
                if (ReadOnlyService.readOnlyActive) return;
                showBasicAlert("Please drag the image into the browser.");
            });


        var btnsMini = false;
        $("#minMaxBtn")
            .off("click")
            .click(function () {
                if (!btnsMini) {
                    $("#toolbar").find(".btn-group:not(.minGroup)").hide();
                    $(this).find("#minBtn").hide();
                    $(this).find("#maxBtn").show();
                } else {
                    $("#toolbar").find(".btn-group").show();
                    $(this).find("#minBtn").show();
                    $(this).find("#maxBtn").hide();
                }
                btnsMini = !btnsMini;
            });

        if (urlParams.get("hidetoolbar") === "true") {
            $("#toolbar").hide();
        }

        // On thickness slider change
        $("#whiteboardThicknessSlider").on("input", function () {
            if (ReadOnlyService.readOnlyActive) return;
            whiteboard.setStrokeThickness($(this).val());
        });

        // handle drag&drop
        var dragCounter = 0;
        $("#whiteboardContainer").on("dragenter", function (e) {
            if (ReadOnlyService.readOnlyActive) return;
            e.preventDefault();
            e.stopPropagation();
            dragCounter++;
            whiteboard.dropIndicator.show();
        });

        $("#whiteboardContainer").on("dragleave", function (e) {
            if (ReadOnlyService.readOnlyActive) return;

            e.preventDefault();
            e.stopPropagation();
            dragCounter--;
            if (dragCounter === 0) {
                whiteboard.dropIndicator.hide();
            }
        });

        $("#whiteboardContainer").on("drop", function (e) {
            //Handle drop
            if (ReadOnlyService.readOnlyActive) return;

            if (e.originalEvent.dataTransfer) {
                if (e.originalEvent.dataTransfer.files.length) {
                    //File from harddisc
                    e.preventDefault();
                    e.stopPropagation();
                    var filename = e.originalEvent.dataTransfer.files[0]["name"];
                    if (isImageFileName(filename)) {
                        var blob = e.originalEvent.dataTransfer.files[0];
                        var reader = new window.FileReader();
                        reader.readAsDataURL(blob);
                        reader.onloadend = function () {
                            const base64data = reader.result;
                            uploadImgAndAddToWhiteboard(base64data);
                        };
                    } else if (isPDFFileName(filename)) {
                        //Handle PDF Files
                        var blob = e.originalEvent.dataTransfer.files[0];

                        var reader = new window.FileReader();
                        reader.onloadend = function () {
                            var pdfData = new Uint8Array(this.result);

                            var loadingTask = pdfjsLib.getDocument({ data: pdfData });
                            loadingTask.promise.then(
                                function (pdf) {
                                    console.log("PDF loaded");

                                    var currentDataUrl = null;
                                    var modalDiv = $(
                                        "<div>" +
                                            "Page: <select></select> " +
                                            '<button style="margin-bottom: 3px;" class="modalBtn"><i class="fas fa-upload"></i> Upload to Whiteboard</button>' +
                                            '<img style="width:100%;" src=""/>' +
                                            "</div>"
                                    );

                                    modalDiv.find("select").change(function () {
                                        showPDFPageAsImage(parseInt($(this).val()));
                                    });

                                    modalDiv
                                        .find("button")
                                        .off("click")
                                        .click(function () {
                                            if (currentDataUrl) {
                                                $(".basicalert").remove();
                                                uploadImgAndAddToWhiteboard(currentDataUrl);
                                            }
                                        });

                                    for (var i = 1; i < pdf.numPages + 1; i++) {
                                        modalDiv
                                            .find("select")
                                            .append('<option value="' + i + '">' + i + "</option>");
                                    }

                                    showBasicAlert(modalDiv, {
                                        header: "Pdf to Image",
                                        okBtnText: "cancel",
                                        headercolor: "#0082c9",
                                    });

                                    // render newly added icons
                                    dom.i2svg();

                                    showPDFPageAsImage(1);
                                    function showPDFPageAsImage(pageNumber) {
                                        // Fetch the page
                                        pdf.getPage(pageNumber).then(function (page) {
                                            console.log("Page loaded");

                                            var scale = 1.5;
                                            var viewport = page.getViewport({ scale: scale });

                                            // Prepare canvas using PDF page dimensions
                                            var canvas = $("<canvas></canvas>")[0];
                                            var context = canvas.getContext("2d");
                                            canvas.height = viewport.height;
                                            canvas.width = viewport.width;

                                            // Render PDF page into canvas context
                                            var renderContext = {
                                                canvasContext: context,
                                                viewport: viewport,
                                            };
                                            var renderTask = page.render(renderContext);
                                            renderTask.promise.then(function () {
                                                var dataUrl = canvas.toDataURL("image/jpeg", 1.0);
                                                currentDataUrl = dataUrl;
                                                modalDiv.find("img").attr("src", dataUrl);
                                                console.log("Page rendered");
                                            });
                                        });
                                    }
                                },
                                function (reason) {
                                    // PDF loading error

                                    showBasicAlert(
                                        "Error loading pdf as image! Check that this is a vaild pdf file!"
                                    );
                                    console.error(reason);
                                }
                            );
                        };
                        reader.readAsArrayBuffer(blob);
                    } else {
                        showBasicAlert("File must be an image!");
                    }
                } else {
                    //File from other browser

                    var fileUrl = e.originalEvent.dataTransfer.getData("URL");
                    var imageUrl = e.originalEvent.dataTransfer.getData("text/html");
                    var rex = /src="?([^"\s]+)"?\s*/;
                    var url = rex.exec(imageUrl);
                    if (url && url.length > 1) {
                        url = url[1];
                    } else {
                        url = "";
                    }

                    isValidImageUrl(fileUrl, function (isImage) {
                        if (isImage && isImageFileName(url)) {
                            whiteboard.addImgToCanvasByUrl(fileUrl);
                        } else {
                            isValidImageUrl(url, function (isImage) {
                                if (isImage) {
                                    if (isImageFileName(url) || url.startsWith("http")) {
                                        whiteboard.addImgToCanvasByUrl(url);
                                    } else {
                                        uploadImgAndAddToWhiteboard(url); //Last option maybe its base64
                                    }
                                } else {
                                    showBasicAlert("Can only upload Imagedata!");
                                }
                            });
                        }
                    });
                }
            }
            dragCounter = 0;
            whiteboard.dropIndicator.hide();
        });

        new Picker({
            parent: $("#whiteboardColorpicker")[0],
            color: "#000000",
            onChange: function (color) {
                whiteboard.setDrawColor(color.rgbaString);
            },
        });

        // on startup select mouse
        shortcutFunctions.setTool_mouse();
        // fix bug cursor not showing up
        whiteboard.refreshCursorAppearance();

        if (process.env.NODE_ENV === "production") {
            if (ConfigService.readOnlyOnWhiteboardLoad) ReadOnlyService.activateReadOnlyMode();
            else ReadOnlyService.deactivateReadOnlyMode();

            if (ConfigService.displayInfoOnWhiteboardLoad) InfoService.displayInfo();
            else InfoService.hideInfo();
        } else {
            // in dev
            ReadOnlyService.deactivateReadOnlyMode();
            InfoService.displayInfo();
        }

        // In any case, if we are on read-only whiteboard we activate read-only mode
        if (ConfigService.isReadOnly) ReadOnlyService.activateReadOnlyMode();
    });

    //Prevent site from changing tab on drag&drop
    window.addEventListener(
        "dragover",
        function (e) {
            e = e || event;
            e.preventDefault();
        },
        false
    );
    window.addEventListener(
        "drop",
        function (e) {
            e = e || event;
            e.preventDefault();
        },
        false
    );

    function uploadImgAndAddToWhiteboard(base64data) {
        const date = +new Date();
        $.ajax({
            type: "POST",
            url: document.URL.substr(0, document.URL.lastIndexOf("/")) + "/api/upload",
            data: {
                imagedata: base64data,
                whiteboardId: whiteboardId,
                date: date,
                at: accessToken,
            },
            success: function (msg) {
                const { correspondingReadOnlyWid } = ConfigService;
                const filename = `${correspondingReadOnlyWid}_${date}.png`;
                const rootUrl = document.URL.substr(0, document.URL.lastIndexOf("/"));
                whiteboard.addImgToCanvasByUrl(
                    `${rootUrl}/uploads/${correspondingReadOnlyWid}/${filename}`
                ); //Add image to canvas
                console.log("Image uploaded!");
            },
            error: function (err) {
                showBasicAlert("Failed to upload frame: " + JSON.stringify(err));
            },
        });
    }

    // verify if filename refers to an image
    function isImageFileName(filename) {
        var extension = filename.split(".")[filename.split(".").length - 1];
        var known_extensions = ["png", "jpg", "jpeg", "gif", "tiff", "bmp", "webp"];
        return known_extensions.includes(extension.toLowerCase());
    }

    // verify if filename refers to an pdf
    function isPDFFileName(filename) {
        var extension = filename.split(".")[filename.split(".").length - 1];
        var known_extensions = ["pdf"];
        return known_extensions.includes(extension.toLowerCase());
    }

    // verify if given url is url to an image
    function isValidImageUrl(url, callback) {
        var img = new Image();
        var timer = null;
        img.onerror = img.onabort = function () {
            clearTimeout(timer);
            callback(false);
        };
        img.onload = function () {
            clearTimeout(timer);
            callback(true);
        };
        timer = setTimeout(function () {
            callback(false);
        }, 2000);
        img.src = url;
    }

    // handle pasting from clipboard
    window.addEventListener("paste", function (e) {
        if ($(".basicalert").length > 0) {
            return;
        }
        if (e.clipboardData) {
            var items = e.clipboardData.items;
            var imgItemFound = false;
            if (items) {
                // Loop through all items, looking for any kind of image
                for (var i = 0; i < items.length; i++) {
                    if (items[i].type.indexOf("image") !== -1) {
                        imgItemFound = true;
                        // We need to represent the image as a file,
                        var blob = items[i].getAsFile();

                        var reader = new window.FileReader();
                        reader.readAsDataURL(blob);
                        reader.onloadend = function () {
                            console.log("Uploading image!");
                            let base64data = reader.result;
                            uploadImgAndAddToWhiteboard(base64data);
                        };
                    }
                }
            }

            if (!imgItemFound && whiteboard.tool != "text") {
                showBasicAlert(
                    "Please Drag&Drop the image or pdf into the Whiteboard. (Browsers don't allow copy+past from the filesystem directly)"
                );
            }
        }
    });
}

export default main;
