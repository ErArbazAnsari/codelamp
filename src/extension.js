const vscode = require("vscode");
const { SidebarProvider } = require("./utils/SidebarProvider");

function activate(context) {
    console.log("CodeLamp extension activating...");

    try {
        const sidebarProvider = new SidebarProvider(
            context.extensionUri,
            context
        );
        console.log("SidebarProvider created");

        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                "codelamp.sidebarWebView",
                sidebarProvider
            )
        );
        console.log("Webview provider registered");
    } catch (error) {
        console.error("Error activating extension:", error);
        vscode.window.showErrorMessage(
            `CodeLamp activation failed: ${error.message}`
        );
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
};
