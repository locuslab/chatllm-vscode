import * as vscode from 'vscode';
import { getEncoding, encodingForModel } from "js-tiktoken";
import { callChatGPT, callTogether, callGoogle, callAzure,
    OpenAIModelSettings, TogetherModelSettings, GoogleModelSettings, AzureModelSettings,
    ModelSettings, API, callOpenAIImageGen, OpenAIImageGenSettings, StreamAsyncGenerator, callAzureImageGen, AzureImageGenSettings } from './llmInterface.ts';
import { ChatLLMNotebookSerializer } from './serializer.ts';
import { SettingsEditorPanel } from './settingsEditor';
import path from 'path';

import { useIdentityPlugin, DefaultAzureCredential, VisualStudioCodeCredential } from "@azure/identity";
//import type { AzureExtensionApiProvider } from '@microsoft/vscode-azext-utils/api';
import { vsCodePlugin } from "@azure/identity-vscode";
import { TokenCredential } from '@azure/core-auth';

import { AzureAccountExtensionApi } from './azure/azure-account.api'; // Other extensions need to copy this .d.ts to their repository.


useIdentityPlugin(vsCodePlugin);

type ChatMessage = {
    role: string;
    content: string;
};

type ChatMessagesArray = ChatMessage[];

type ModelSpec = ModelSettings & {
    [key : string]: any;
};

function errorModelSpec(): ModelSpec {
    return {
        name: '',
        api: API.none,
    };
}


let modelStatusBarItem;


export function activate(context: vscode.ExtensionContext) {

    
    context.subscriptions.push(new ChatLLMController());
    context.subscriptions.push(vscode.commands.registerCommand('chatllm.selectModel', selectModel));
    context.subscriptions.push(vscode.commands.registerCommand('chatllm.detachOutput', detachOutput));
    context.subscriptions.push(vscode.workspace.registerNotebookSerializer(
        'chatllm-notebook', new ChatLLMNotebookSerializer()
      ));

      context.subscriptions.push(vscode.commands.registerCommand('chatllm.editSettings', () => {
        SettingsEditorPanel.createOrShow(context.extensionUri);
      }));

    modelStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    modelStatusBarItem.show();
    context.subscriptions.push(modelStatusBarItem);
    
    vscode.window.onDidChangeActiveNotebookEditor(updateStatusBarItem);
    vscode.window.onDidChangeNotebookEditorSelection(updateStatusBarItem);

    vscode.workspace.onDidChangeNotebookDocument(notebookChangedEvent);

    const messageChannel = vscode.notebooks.createRendererMessaging('myMarkdownWithLatexRenderer');
    messageChannel.onDidReceiveMessage(e => {
        if (e.message.request === 'copyText') {
            vscode.env.clipboard.writeText(e.message.data);
        }
    });
}

// This method is called when your extension is deactivated
export function deactivate() {}

// dev helper function to dump all the command identifiers to the console
// helps if you cannot find the command id on github.
var findCommand = function(){
    vscode.commands.getCommands(true).then( 
        function(cmds){
            console.log("fulfilled");
            console.log(cmds);
        },
        function() {
            console.log("failed");
            console.log(arguments);
        }
    )
};

class ChatLLMController {
    readonly controllerId = 'chatllm-notebook-controller';
    readonly notebookType = 'chatllm-notebook';
    readonly label = 'ChatLLM Notebook';
    readonly supportedLanguages = ['chatllm', 'chatllm-system-prompt'];
    
    private readonly _controller: vscode.NotebookController;
    private _executionOrder = 0;
    
    constructor() {
        this._controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
            );
            
            this._controller.supportedLanguages = this.supportedLanguages;
            this._controller.supportsExecutionOrder = true;
            this._controller.executeHandler = this._execute.bind(this);
            
    }
        
    dispose() {
        // Clean up resources, if any
        this._controller.dispose();
    }

        
    private _execute(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
        ): void {
        for (let cell of cells) {
            this._doExecution(cell);
        }
    }

    /**
     * Get the AzureTokenCredentials
     * TODO: Cache the credentials and don't retrieve them on every call
     */
    private getAzureTokenCredentials(): Promise<TokenCredential> {
        const azureAccount: AzureAccountExtensionApi = (vscode.extensions.getExtension('ms-vscode.azure-account'));
        return new Promise((resolve) => {
            if(azureAccount.isActive == false ){
                azureAccount.activate().then(
                    async function(){
                        console.log( "Extension activated");
                        const apiAzureAccount = (azureAccount)!.exports;
                        if (!(await apiAzureAccount.waitForLogin())) {
                            await vscode.commands.executeCommand('azure-account.askForLogin');
                        }

                        const sessions = await apiAzureAccount.sessions;
                        const credentials2 = await apiAzureAccount.sessions[0].credentials2;
                        console.log("Credentials ", credentials2);
                        console.log("Sessions ", sessions);
                        return resolve(credentials2);
                    }
                );
            } else {
                console.log("Extension is already activated");
                const apiAzureAccount = (azureAccount)!.exports;
                return resolve(apiAzureAccount.sessions[0].credentials2);

            } 
        });
    }
            
    private async _doExecution(cell: vscode.NotebookCell): Promise<void> {
        const execution = this._controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this._executionOrder;
        execution.start(Date.now());

        if (cell.document.languageId === 'chatllm') {

            const config = vscode.workspace.getConfiguration('chatllm');
            const models : ModelSpec[] = config.get("models",[]);
            const model : ModelSpec = models.find(item => item.name === cell.metadata.model) || errorModelSpec();

            if (model) {
                // convert to list of messages
                const cells = [...cell.notebook.getCells().filter(c => c.index < cell.index), cell];
                const messages = await getMessages(cells);
                const collapsedMessages = collapseConsecutiveMessages(messages, model.truncateTokens, model.truncateSysPrompt);


                let stream : StreamAsyncGenerator;
                let abort : () => void;

                if (model.api === API.openai) {
                    ({stream, abort} = callChatGPT(collapsedMessages, model as OpenAIModelSettings));
                } else if (model.api === API.together) {
                    ({stream, abort} = callTogether(collapsedMessages, model as TogetherModelSettings));
                } else if (model.api === API.google) {
                    ({stream, abort} = callGoogle(collapsedMessages, model as GoogleModelSettings));
                } else if (model.api === API.azure) {
                    //Retrieve  Azure token credentials
                    const accessToken = await this.getAzureTokenCredentials();
                    console.log("Access token ", await accessToken.getToken());
                    ({stream, abort} = callAzure(collapsedMessages, model as AzureModelSettings, accessToken));                    
                } else if (model.api === API.openaiImageGen) {
                    ({stream, abort} = callOpenAIImageGen(collapsedMessages, model as OpenAIImageGenSettings));
                } else if (model.api === API.azureImageGen) {
                    ({stream, abort} = callAzureImageGen(collapsedMessages, model as AzureImageGenSettings));
                } else {
                    vscode.window.showErrorMessage("No valid model specified.  Select a model for the cell using the 'ChatLLM: Select Model' command.");
                    execution.end(true, Date.now());
                    return;
                }

                const response = {};
                let userCancelled = false;
                function timer() {
                    return new Promise(resolve => {
                        setTimeout(() => {
                            resolve({ value: undefined, done: false });
                        }, 100);
                    });
                }
                execution.token.onCancellationRequested(() => {userCancelled = true; abort(); });

                let nextResult = stream.next();
                while (true) {
                    const result = await Promise.race([nextResult, timer()]) as {value: string | {output_type:string, content:string}, done: boolean};
                    if (result.value) {
                        if (typeof(result.value) === 'string') {
                            response['text/markdown'] = (response['text/markdown'] || '') + result.value;
                        } else if (result.value.output_type === 'text/markdown') {
                            response['text/markdown'] = (response['text/markdown'] || '') + result.value.content;
                        } else if (result.value.output_type === 'image/png') {
                            response['image/png'] = (response['image/png'] || '') + result.value.content;
                        }

                        const cell_outputs : vscode.NotebookCellOutput[] = [];
                        if (response['image/png'] !== undefined) {
                            const imageData = Buffer.from(response['image/png'], 'base64');
                            cell_outputs.push(new vscode.NotebookCellOutput([
                                new vscode.NotebookCellOutputItem(imageData, 'image/png')]));
                        }
                        if (response['text/markdown'] !== undefined) {

                            cell_outputs.push(new vscode.NotebookCellOutput([
                                vscode.NotebookCellOutputItem.text(response['text/markdown'], 'text/markdown')]));
                        }
                        execution.replaceOutput(cell_outputs);



                        nextResult = stream.next();
                    }
                
                    if (result.done || userCancelled) {
                        break;
                    }
                }
            }
        }

        execution.end(true, Date.now());
    }
}

export async function readFileContent(relativeFilePath) {
    // Get the currently active text editor
    const activeEditor = vscode.window.activeTextEditor;
    
    if (activeEditor) {
        // Get the directory of the currently open file
        const currentFileDir = path.dirname(activeEditor.document.uri.fsPath);
        // Create the full path to the relative file
        const fullPathToFile = path.join(currentFileDir, relativeFilePath);
        const fileUri = vscode.Uri.file(fullPathToFile);
        const fileContentUint8Array = await vscode.workspace.fs.readFile(fileUri);
        return fileContentUint8Array;
    } else {
        throw Error('No active text editor');
    }
}


async function processText(inputText) {
    // Updated regex pattern to allow for optional whitespace
    const regexPattern = /{{%%\s*(.*?)\s*%%}}/g;
    
    // Synchronous function to process each match
    async function processMatch(match, command, filename) {
        if (command === 'include' && filename) {
            try {
                const fileContent = await readFileContent(filename.trim());
                return new TextDecoder().decode(fileContent);
            } catch (error) {
                vscode.window.showErrorMessage(`Could not read file: ${filename.trim()}\nError: ${error}`);
                return ''; // Remove the match if there is an error
            }
        } else {
            vscode.window.showErrorMessage(`Couldn't parse commnd ${command}`);
            return ''; // If there's another command or no command, remove the match
        }
    }

    // Asynchronously replace the matched content by processing each match
    const matches = [...inputText.matchAll(regexPattern)];
    for (const match of matches) {
        const [command, filename] = match[1].trim().split(/\s+/); // Split command and filename
        const replacement = await processMatch(match[0], command, filename);
        inputText = inputText.replace(match[0], replacement);
    }
  
  return inputText;
}



const tokenEncoder = getEncoding("gpt2");
async function getMessages(cells : vscode.NotebookCell[]) {
    const messages: ChatMessage[] = [];

    for (const cell of cells) {
        if (cell.document.languageId === 'chatllm-system-prompt') {
            messages.push({ role: 'system', content: await processText(cell.document.getText()) || '' });
        } else if (cell.document.languageId.startsWith('chatllm')) {
            messages.push({ role: 'user', content: await processText(cell.document.getText()) || '' });

            // Handle output only for previous cells, not for the current cell
            if (cell.outputs.length > 0 && cell !== cells[cells.length - 1]) {
                for (const output of cell.outputs) {
                    if (output.items[0].mime === 'text/markdown') {
                        const assistantMessageContent = new TextDecoder().decode(output.items[0].data);
                        messages.push({ role: 'assistant', content: assistantMessageContent });
                    } else if (output.items[0].mime === 'image/png') {
                        // this is a very hacky way to handle API-generated images, so probably want to fix later
                        const base64_img = Buffer.from(output.items[0].data).toString('base64');
                        messages.push({ role: 'user', content: `![%%ChatLLM Inline Image](data:image/png;base64,${base64_img})`});
                    }
                }
                
            }
        } else if (cell.document.languageId === 'markdown') {
            const cellText = await processText(cell.document.getText());
            const role = cellText.startsWith("#### (Chat Output)\n") ? "assistant" : "user";
            messages.push({ role, content: cellText });
        }
    }
    return messages;
}


function collapseConsecutiveMessages(messages: ChatMessagesArray, truncation: number | undefined, truncateSysPrompt : boolean | undefined ): ChatMessagesArray {
    // Collapse together consecutive roles of the same type

    const collapsedMessages: ChatMessagesArray = [{role:"system", content:""}];
    for (const message of messages) {
        if (message.role === "system") {
            collapsedMessages[0].content += "\n" + message.content;
        } else if (message.role === collapsedMessages[collapsedMessages.length-1].role) {
            collapsedMessages[collapsedMessages.length-1].content += "\n" + message.content;
        } else {
            collapsedMessages.push({...message});
        }
    }

    // Truncate input, but always include system prompt and last input
    if (truncation) {
        let truncatedSubset : ChatMessagesArray = [];

        let currentSum = 0;
        if ((typeof truncateSysPrompt !== "boolean") || truncateSysPrompt) {
            currentSum += tokenEncoder.encode(collapsedMessages[0].content).length;
        }

        for (let i = collapsedMessages.length - 1; i >= 1; i--) {
            truncatedSubset.unshift(collapsedMessages[i]);
            currentSum += tokenEncoder.encode(collapsedMessages[i].content).length;
            if (currentSum > truncation) {
                break;
            }
        }
        truncatedSubset.unshift(collapsedMessages[0]);
        return truncatedSubset;
    } else {
        return collapsedMessages;
    }
}




async function detachOutput() {
    const activeEditor = vscode.window.activeNotebookEditor;
    if (!activeEditor) {
        vscode.window.showWarningMessage('No active notebook editor found');
        return;
    }

    const currentCell = activeEditor.notebook.cellAt(activeEditor.selection.start);
    if (!currentCell || activeEditor.selection.end > activeEditor.selection.start + 1 ||
        currentCell.document.languageId !== "chatllm") {
        vscode.window.showInformationMessage('Single ChatLLM cell must be selected');
        return;
    }

    if (currentCell.kind !== vscode.NotebookCellKind.Code) {
        vscode.window.showInformationMessage('Can only split code cell');
        return;
    }
  
    if (currentCell.outputs.length === 0) {
        vscode.window.showInformationMessage('The selected cell has no outputs');
        return;
    }
  
    // Convert the output to a markdown-friendly format
    // Here we assume the output is plain text
    const outputContent = "#### (Chat Output)\n" + currentCell.outputs.map(output =>
      output.items.map(item => item.mime === 'text/markdown' ? new TextDecoder().decode(item.data) : '').join('\n')
    ).join('\n').trim();

  
    // Create a new markdown cell with the content
    const newCellData = new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        currentCell.document.getText(),
        currentCell.document.languageId
    );

    const markdownCellData = new vscode.NotebookCellData(
      vscode.NotebookCellKind.Markup,
      outputContent,
      'markdown'
    );

    // Apply the workspace edit to insert the markdown cell into the document
    const workspaceEdit = new vscode.WorkspaceEdit();
    const rng = new vscode.NotebookRange(activeEditor.selection.start, activeEditor.selection.end);
    const nbEditReplace = vscode.NotebookEdit.replaceCells(rng, [newCellData]);
    workspaceEdit.set(activeEditor.notebook.uri, [nbEditReplace]);

    const nbEditNew = vscode.NotebookEdit.insertCells(activeEditor.selection.start+1, [markdownCellData]);
    workspaceEdit.set(activeEditor.notebook.uri, [nbEditNew]);

    await vscode.workspace.applyEdit(workspaceEdit);
}


interface MyQuickPickItem extends vscode.QuickPickItem {
    obj: ModelSpec;
}

async function selectModel() {
    const activeEditor = vscode.window.activeNotebookEditor;
    if (!activeEditor) {
        vscode.window.showWarningMessage('No active notebook editor found');
        return;
    }

    const currentCell = activeEditor.notebook.cellAt(activeEditor.selection.start);
    if (!currentCell || activeEditor.selection.end > activeEditor.selection.start + 1 || 
        currentCell.document.languageId !== "chatllm") {
        vscode.window.showInformationMessage('Single ChatLLM cell must be selected');
        return;
    }

    if (currentCell.kind !== vscode.NotebookCellKind.Code) {
        vscode.window.showInformationMessage('Can select model for code cell');
        return;
    }

    const config = vscode.workspace.getConfiguration('chatllm');
    const models : string[] = config.get<ModelSpec[]>("models",[]).map(item => (item.name));
    const selectedModel = await vscode.window.showQuickPick(models, {
        placeHolder: 'Select cell model',
    });
    if (selectedModel) {
        setCellModel(currentCell, selectedModel);
    }
    updateStatusBarItem();
}


async function setCellModel(cell: vscode.NotebookCell, model : string | undefined) {
    const workspaceEdit = new vscode.WorkspaceEdit();
    let newMetadata;
    if (model) {
        newMetadata = {...cell.metadata, model:model};
    } else {
        const {model: _, ...rest} = cell.metadata;
        newMetadata = rest;
    }
    const nbEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, newMetadata);
    workspaceEdit.set(cell.notebook.uri, [nbEdit]);
    await vscode.workspace.applyEdit(workspaceEdit);
}


const cellLanguageMap = new Map<string, string>();
const cellLengthMap = new Map<string,number>();
function notebookChangedEvent(event : vscode.NotebookDocumentChangeEvent) {

    // handle adding a new cell => adopt the model of the immediate cell above
    event.contentChanges.forEach(change => {
        if (change.addedCells) {
            change.addedCells.forEach(cell => {
                if (cell.document.languageId === "chatllm") {
                    const previousCell = getPreviousCodeLLMCell(cell);
                    if (previousCell?.metadata?.model) {
                        setCellModel(cell, previousCell.metadata.model);
                    } else {
                        const config = vscode.workspace.getConfiguration('chatllm');
                        setCellModel(cell, config.get("models",[errorModelSpec()])[0].name);
                    }
                }
            });
        }
    });

    // handle changing the language of existing cell => remove model, or set to the cell above or default
    event.cellChanges.forEach(async change => {
        if (change.cell.document.languageId !== cellLanguageMap.get(change.cell.document.uri.toString())) {
            cellLanguageMap.set(change.cell.document.uri.toString(), change.cell.document.languageId);
            if (change.cell.document.languageId === "chatllm") {
                if (change.cell.metadata?.model === undefined) {
                    const previousCell = getPreviousCodeLLMCell(change.cell);
                    if (previousCell?.metadata?.model) {
                        setCellModel(change.cell, previousCell.metadata.model);
                    } else {
                        const config = vscode.workspace.getConfiguration('chatllm');
                        setCellModel(change.cell, config.get("models",[errorModelSpec()])[0].name);
                    }
                }
            } else {
                if (change.cell.metadata?.model) {
                    setCellModel(change.cell, undefined);
                }
            }
        }
    });
    updateStatusBarItem();
}


function getPreviousCodeLLMCell(cell : vscode.NotebookCell) {
    const previousCells = cell.notebook.getCells().filter(c => (c.index < cell.index && 
                                                                c.kind === vscode.NotebookCellKind.Code &&
                                                                c.document.languageId === "chatllm"));
    return (previousCells.length >= 0) ? previousCells[previousCells.length - 1] : null;
}



function updateStatusBarItem() {
    const activeEditor = vscode.window.activeNotebookEditor;
    if (activeEditor && activeEditor.selections.length > 0) {
        const selectedCell = activeEditor.notebook.cellAt(activeEditor.selections[0].start);
        const model = selectedCell.metadata.model as string | undefined;

        if (model) {
            modelStatusBarItem.text = `Cell Model: ${model}`;
            modelStatusBarItem.show();
        } else {
            modelStatusBarItem.hide();
        }
    } else {
        modelStatusBarItem.hide();
    }
}
  
