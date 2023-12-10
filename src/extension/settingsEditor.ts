import * as vscode from 'vscode';
import * as schema from './settingsEditorSchema.json';



export class SettingsEditorPanel {
    public static currentPanel: SettingsEditorPanel | undefined;
    public static readonly viewType = 'chatllmSettingsEditor';
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    
    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : undefined;
        
        // If we already have a panel, show it.
        if (SettingsEditorPanel.currentPanel) {
            SettingsEditorPanel.currentPanel._panel.reveal(column);
            return;
        }
        
        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            SettingsEditorPanel.viewType,
            'ChatLLM Settings Editor',
            column || vscode.ViewColumn.One,
            {
                // Enable JavaScript in the webview
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')]
            });
        SettingsEditorPanel.currentPanel = new SettingsEditorPanel(panel, extensionUri);
    }
    
    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        
        // Set the webview's initial html content
        this._update();
        
        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        
        // Update the content based on view changes
        this._panel.onDidChangeViewState(e => {
                if (this._panel.visible) {
                    this._update();
                }
            },
            null,
            this._disposables);
            
        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case "send":
                        console.log(message.data);
                        break;
                    case "confirm":
                        const userConfirmed = await showConfirmDialog(message.text);
                        if (userConfirmed) {
                            this._panel.webview.postMessage({ command: 'confirmed', key: message.key});
                        }
                        break;

                    case "finishedInit":
                        this._panel.webview.postMessage({command:'sendSchema', schema:schema});
                        this._panel.webview.postMessage({command:'sendModels', models:vscode.workspace.getConfiguration('chatllm').get('models',[])});
                        break;

                    case "updateModel":
                        const updateModels = vscode.workspace.getConfiguration('chatllm').get<any[]>("models", []);
                        if (updateModels.length > message.index) {
                            updateModels[message.index] = message.model;
                        }
                        vscode.workspace.getConfiguration('chatllm').update("models", updateModels, vscode.ConfigurationTarget.Global);
                        break;

                    case "addModel":
                        const addModels = vscode.workspace.getConfiguration('chatllm').get<any[]>("models", []);
                        addModels.push(message.model);
                        vscode.workspace.getConfiguration('chatllm').update("models", addModels, vscode.ConfigurationTarget.Global);
                        break;

                    case "removeModel":
                        const removeModels = vscode.workspace.getConfiguration('chatllm').get<any[]>("models", []);
                        removeModels.splice(message.index, message.index);
                        vscode.workspace.getConfiguration('chatllm').update("models", removeModels, vscode.ConfigurationTarget.Global);
                        break;


                }
            },
            null, this._disposables);
    }

    public dispose() {
        SettingsEditorPanel.currentPanel = undefined;
        
        // Clean up our resources
        this._panel.dispose();
        
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Use the cspSource to create a simple Content Security Policy
        const nonce = getNonce();
        const cspSource = webview.cspSource;
        const settingsWebviewUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'settingsWebview.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webviewStyle.css'));

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
          <title>ChatLLM Settings Editor</title>
          <link rel="stylesheet" href="${styleUri}">
        </head>
        <body>
            <h1>ChatLMM Settings</h1>
            <div class="container">
            
                <div class="model-list-pane">
                    <h4>Models</h4>
                    <vscode-data-grid id="model-list" generate-header="none">
                        <!-- Model rows will be populated here by the script -->
                    </vscode-data-grid>

                    <div>
                        <vscode-button id="add-model">Add</vscode-button>
                        <vscode-button id="remove-model">Remove</vscode-button>
                    </div>
                </div>
                
                <div class="model-detail-pane">
                    <h4>Model Details</h4>
                    <div id="model-detail">
                    </div>
                </div>
            </div>
          
            <script type="module" nonce="${nonce}" src="${settingsWebviewUri}"></script>
        </body>
        </html>`;
    }
}


async function showConfirmDialog(message) {
    const confirmButton = 'Confirm';
    const result = await vscode.window.showInformationMessage(
        message,
        { modal: true },
        confirmButton
    );
    return result === confirmButton;
}

// Function to generate nonce
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }