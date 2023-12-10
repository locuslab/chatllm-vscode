import { 
    provideVSCodeDesignSystem, 
    vsCodeDataGrid, 
    vsCodeButton, 
    vsCodeDataGridRow, 
    vsCodeTextField,
    vsCodeDataGridCell,
    DataGrid,
    DataGridRow,
    DataGridCell,
    vsCodeDropdown,
    vsCodeOption,
    Option,
} from '@vscode/webview-ui-toolkit';


provideVSCodeDesignSystem().register(vsCodeDataGrid(), 
                                     vsCodeButton(), 
                                     vsCodeDataGridRow(), 
                                     vsCodeDataGridCell(),
                                     vsCodeTextField(),
                                     vsCodeDropdown(),
                                     vsCodeOption()
);
const vscode = acquireVsCodeApi();
let schema;
let models;

window.addEventListener("load", main);
window.addEventListener("message", event => {
    const message = event.data; // The JSON data our extension sent
    console.log(message);
    
    switch(message.command) {
        case 'sendSchema':
            schema = message.schema;
            break;
        case 'sendModels':
            models = message.models;
            updateModelList(models);
            break;
        case 'confirmed':
            if (message.key === "removeModel") {
                reallyRemoveModel();
            }
    }
});

function main() {
    document.getElementById('add-model')?.addEventListener('click', addModel);
    document.getElementById('remove-model')?.addEventListener('click', removeModel);
    vscode.postMessage({command:"finishedInit"});
}


function addModel() {
    console.log("adding model");
    // construct default model
    const defaultModel: any = {};
    
    schema.chatllm.forEach(prop => {
        if (!prop.optional) {
            defaultModel[prop.key] = prop.defaultValue;
        }
    });

    // Determine the default 'api' property
    const defaultApi = schema.chatllm.find(prop => prop.key === 'api')?.defaultValue;
    if (defaultApi && schema[defaultApi]) {
        schema[defaultApi].forEach(prop => {
            if (!prop.optional || prop.defaultValue !== null) {
                defaultModel[prop.key] = prop.defaultValue;
            }
        });
    }

    models.push(defaultModel);
    vscode.postMessage({command:"addModel", model:defaultModel});
    updateModelList(models);
}


function removeModel() {
    console.log("removing model");
    const modelsDataGrid = document.getElementById('model-list') as DataGrid;
    const selectedRow = modelsDataGrid.querySelector('.selected-row') as DataGridRow;
    if (selectedRow && selectedRow.rowData) {
        vscode.postMessage({command:"confirm", text:`Really delete ${selectedRow.rowData['name']}?`, key:"removeModel"});
    }
}

function reallyRemoveModel() {
    console.log("removing model");
    const modelsDataGrid = document.getElementById('model-list') as DataGrid;
    const selectedRow = modelsDataGrid.querySelector('.selected-row') as DataGridRow;
    if (selectedRow && selectedRow.rowData) {
        const modelIndex = selectedRow.rowData["index"];
        models.splice(modelIndex, modelIndex);
        console.log(models);
        vscode.postMessage({command:"removeModel", index:modelIndex});
        updateModelList(models);
    }
}



function updateModelList(models) {
    const modelsDataGrid = document.getElementById('model-list') as DataGrid;
    modelsDataGrid.columnDefinitions = [{columnDataKey: "name", title: "Name" }];
    modelsDataGrid.rowsData = models.map((model,index) => ({"name": model.name, "index":index }));

    const modelDetailPane = document.getElementById('model-detail');
    if (modelDetailPane) {
        modelDetailPane.innerHTML = ''; // Clear previous details
    }

    // Listen for the row focus event from the data grid
    modelsDataGrid.addEventListener('row-focused', (e: Event) => {
        const previouslySelectedRow = modelsDataGrid.querySelector('.selected-row');
        if (previouslySelectedRow) {
            previouslySelectedRow.classList.remove('selected-row');
        }

        const row = e.target as DataGridRow;
        row.classList.add('selected-row');
        
        if (row && row.rowData) {
            const rowIndex = row.rowData['index'];
            populateModelDetails(models[rowIndex], rowIndex);
        }
    });

    
    


}


function populateModelDetails(selectedModel, modelIndex) {
    const modelDetailPane = document.getElementById('model-detail');
    if (!modelDetailPane) {
        return;
    }
    modelDetailPane.innerHTML = ''; // Clear previous details
  
    // Start with the universal model properties
    const generalProperties = schema.chatllm;
  
    // Then add the API-specific properties if any
    const apiProperties = schema[selectedModel.api] || [];
  
    // Combine the general properties with the specific properties for this API
    const combinedProperties = [...generalProperties, ...apiProperties];
  
    // Create fields for each property in the combined list
    combinedProperties.forEach(property => {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = "property-field-container";
        
        const label = document.createElement('div');
        label.className = "label-space";
        label.textContent = `${property.description}${property.optional ? ' (Optional)' : ''}:`;
        fieldContainer.appendChild(label);
        
        let editorElement;
        if (property.type === "enum") {
            editorElement = document.createElement('vscode-dropdown');
            property.values.forEach(value => {
                const option = document.createElement('vscode-option') as Option;
                option.textContent = value;
                editorElement.appendChild(option);
            });
            editorElement.value = selectedModel[property.key] || property.defaultValue;
        } else {
            editorElement = document.createElement('vscode-text-field');
            if (property.type === "number") {
                editorElement.size = 20;
            } else {
                editorElement.size = 50;
            }

            if (property.type === "object") {
                editorElement.value = JSON.stringify(selectedModel[property.key]) || '';
            } else {
                editorElement.value = selectedModel[property.key] || '';
            }
        }
        
        editorElement.addEventListener('change', (event) => {
            const newValue = event.target.value;


            if (property.optional && newValue === '') {
                delete models[modelIndex][property.key];
            } else {
                if (property.type === 'number') {
                    const newNumber = Number(newValue);
                    if (!isNaN(newNumber)) {
                        models[modelIndex][property.key] = newNumber;
                    } else {
                        return;
                    }
                } else if (property.type === 'object') {
                    try {
                        models[modelIndex][property.key] = JSON.parse(newValue);
                    } catch {
                        return;
                    }
                } else {
                    models[modelIndex][property.key] = newValue;
                }

                if (property.key === "name") {
                    const modelsDataGrid = document.getElementById('model-list') as DataGrid;
                    const selectedRow = modelsDataGrid.querySelector('.selected-row') as DataGridRow;
                    selectedRow.cellElements[0].innerHTML = newValue;
                }

                if (property.key === "api") {
                    // remove any keys not in the new API
                    const validKeys = new Set(schema.chatllm.map((prop) => prop.key));
                    schema[newValue].forEach((prop) => validKeys.add(prop.key));
                    Object.keys(models[modelIndex]).forEach((key) => {
                        if (!validKeys.has(key)) {
                            delete models[modelIndex][key];
                        }
                    });

                    // add any keys not in the current model that are not optional
                    schema[newValue].forEach((prop) => {
                        if (!prop.optional && !models[modelIndex].hasOwnProperty(prop.key)) {
                            models[modelIndex][prop.key] = prop.defaultValue;
                        }
                    });
                                        
                    populateModelDetails(selectedModel, modelIndex);
                }

                vscode.postMessage({command: 'updateModel', index:modelIndex, model: models[modelIndex]});

            }
            // NOTE: Perform type casting if needed, e.g. for numbers
            // models[modelIndex][property.key] = (property.type === 'number') ? Number(newValue) : newValue;
            
            // Notify the VSCode extension of the change
            //vscode.postMessage({ command: 'updateModel', model: models[modelIndex] }); 
        });
        
        
        fieldContainer.appendChild(editorElement);
        
        modelDetailPane.appendChild(fieldContainer);
    });
}