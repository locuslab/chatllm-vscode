import * as vscode from 'vscode';
import { getEncoding, encodingForModel } from "js-tiktoken";
import { callChatGPT, callTogether, OpenAIModelSettings, TogetherModelSettings } from './llmInterface.ts';
import { ChatLLMNotebookSerializer } from './serializer.ts';
import { SettingsEditorPanel } from './settingsEditor';

type ChatMessage = {
    role: string;
    content: string;
    tokens? : number;
};
type ChatMessagesArray = ChatMessage[];

enum API {
    openai = "openai",
    together = "together",
    none = "none"
}

type ModelSpec = {
    name: string;
    api: API;
    truncateTokens?: number;
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
}



// This method is called when your extension is deactivated
export function deactivate() {}





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
                const messages = await updateMessagesAndMetadata(cells);
                console.log(messages);
                const collapsedMessages = collapseConsecutiveMessages(messages, model.truncateTokens);
                console.log(collapsedMessages);


                let stream : AsyncGenerator<string, void, unknown>;
                let abort : () => void;

                if (model.api === API.openai) {
                    ({stream, abort} = callChatGPT(collapsedMessages, model as OpenAIModelSettings));
                } else if (model.api === API.together) {
                    ({stream, abort} = callTogether(collapsedMessages, model as TogetherModelSettings));
                } else {
                    vscode.window.showErrorMessage("No valid model specified");
                    execution.end(true, Date.now());
                    return;
                }

                let accumulatedResponse = '';
                execution.token.onCancellationRequested(() => abort());

                for await (const response of stream) {
                    accumulatedResponse += response;
                    // Update the cell's output with the accumulated content
                    execution.replaceOutput([
                        new vscode.NotebookCellOutput([
                            vscode.NotebookCellOutputItem.text(accumulatedResponse, 'text/markdown')
                        ])
                    ]);
                }
            }
        }

        execution.end(true, Date.now());
    }
}


const tokenEncoder = getEncoding("gpt2");
async function updateMessagesAndMetadata(cells : vscode.NotebookCell[]) {
    const messages: ChatMessage[] = [];

    for (const cell of cells) {
        let rolesAndContents : ChatMessage[] = [];

        if (cell.document.languageId === 'chatllm-system-prompt') {
            rolesAndContents.push({ role: 'system', content: cell.document.getText() || '' });
        } else if (cell.document.languageId.startsWith('chatllm')) {
            rolesAndContents.push({ role: 'user', content: cell.document.getText() || '' });

            // Handle output only for previous cells, not for the current cell
            if (cell.outputs.length > 0 && cell !== cells[cells.length - 1]) {
                const assistantMessageContent = new TextDecoder().decode(cell.outputs[0].items[0].data);
                rolesAndContents.push({ role: 'assistant', content: assistantMessageContent });
            }
        } else if (cell.document.languageId === 'markdown') {
            const cellText = cell.document.getText();
            const role = cellText.startsWith("#### (Chat Output)\n") ? "assistant" : "user";
            rolesAndContents.push({ role, content: cellText });
        }

        for (const { role, content } of rolesAndContents) {
            // Use existing token count or generate a new one and update metadata
            let numTokens = cell.metadata?.tokens?.[role];
            if (numTokens === undefined && content) {
                numTokens = tokenEncoder.encode(content).length;
                const tokensObj = cell.metadata?.tokens || {};
                tokensObj[role] = numTokens;

                const newMetadata = {...cell.metadata, tokens:tokensObj};

                const nbEdit = vscode.NotebookEdit.updateCellMetadata(cell.index, newMetadata);
                const workspaceEdit = new vscode.WorkspaceEdit();
                workspaceEdit.set(cell.notebook.uri, [nbEdit]);
                await vscode.workspace.applyEdit(workspaceEdit);
            }

            // Add the message to the array with the tokens
            messages.push({ role, content, tokens:numTokens });
        }
    }
    return messages;
}


function collapseConsecutiveMessages(messages: ChatMessagesArray, truncation: number | undefined): ChatMessagesArray {
    // Collapse together consecutive roles of the same type

    const collapsedMessages: ChatMessagesArray = [{role:"system", content:"", tokens:0}];
    for (const message of messages) {
        if (message.role === "system") {
            collapsedMessages[0].content += "\n" + message.content;
            collapsedMessages[0].tokens = (collapsedMessages[0].tokens || 0) + (message.tokens || 0);
        } else if (message.role === collapsedMessages[collapsedMessages.length-1].role) {
            collapsedMessages[collapsedMessages.length-1].content += "\n" + message.content;
            collapsedMessages[collapsedMessages.length-1].content += 1 + (message.tokens || 0);
        } else {
            collapsedMessages.push({...message});
        }
    }

    // Truncate input
    if (truncation) {
        let truncatedSubset : ChatMessagesArray = [];
        let currentSum = 0;
        const max_tokens = truncation - (collapsedMessages[0].tokens || 0);
        for (let i = collapsedMessages.length - 1; i >= 0; i--) {
            if (currentSum + (collapsedMessages[i].tokens || 0) < max_tokens) {
                truncatedSubset.unshift(collapsedMessages[i]);
                currentSum += collapsedMessages[i].tokens || 0;
            } else {
                break;
            }
        }
        truncatedSubset.unshift(collapsedMessages[0]);
        return truncatedSubset.map(({tokens, ...rest}) => rest);
    } else {
        return collapsedMessages.map(({tokens, ...rest}) => rest);
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

        if (change.cell.document.getText().length !== cellLengthMap.get(change.cell.document.uri.toString())) {
            cellLengthMap.set(change.cell.document.uri.toString(), change.cell.document.getText().length);

            const {tokens: _, ...newMetadata} = change.cell.metadata;
            const nbEdit = vscode.NotebookEdit.updateCellMetadata(change.cell.index, newMetadata);
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(change.cell.notebook.uri, [nbEdit]);
            await vscode.workspace.applyEdit(workspaceEdit);
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
  
