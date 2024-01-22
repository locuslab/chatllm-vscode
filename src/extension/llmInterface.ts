import * as vscode from 'vscode';
import OpenAI from 'openai';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import {GoogleGenerativeAI, GenerateContentStreamResult, HarmBlockThreshold, HarmCategory } from '@google/generative-ai';
import { APIPromise, safeJSON } from 'openai/core';
import { OpenAIClient, AzureKeyCredential, ChatRequestMessage} from '@azure/openai';
import { Stream } from 'openai/streaming';
import { readFileContent } from './extension.ts';


import { useIdentityPlugin, DefaultAzureCredential, VisualStudioCodeCredential } from "@azure/identity";
import { vsCodePlugin } from "@azure/identity-vscode";
import { TokenCredential } from '@azure/core-auth';
useIdentityPlugin(vsCodePlugin);





export enum API {
    openai = "openai",
    together = "together",
    google = "google",
    azure = "azure",
    openaiImageGen = "openai-imagegen",
    azureImageGen = "azure-imagegen",
    none = "none"
}

// these are generic properties of all models handled by ChatLLM
export interface ModelSettings {
    name: string,
    api: API,
    truncateTokens?: number,
    truncateSysPrompt?: boolean
}


// these are properties of the OpenAI API
export interface OpenAIModelSettings extends ModelSettings {
    model: string,
    api_key: string,
    url?: string,
    enable_vision? : boolean,
    frequency_penalty?: number,
    logit_bias?: object,
    max_tokens?: number,
    presence_penalty?: number,
    response_format?: object,
    seed?: number,
    stop?: string | Array<string>,
    temperature?: number,
    top_p?: number,
    tools?: Array<string>,
    tool_choice?: string | object,
    user?: string
}

export interface OpenAIImageGenSettings extends ModelSettings {
    model: string,
    api_key: string,
    url?: string,
    n?: number,
    size?: string,
    quality?: string,
    style?: string,
    user?: string
}



export interface TogetherModelSettings extends ModelSettings {
    model: string,
    api_key: string,
    url?: string,
    max_tokens: number,
    stop: string | Array<string>,
    temperature?: number,
    top_p?: number,
    top_k?: number,
    repetition_penalty?: number,
    logprobs?: number,
}


enum BlockThreshold {
    none = "none",
    high = "high",
    medium = "medium",
    low = "low"
}


export interface GoogleModelSettings extends ModelSettings {
    model: string,
    api_key: string,
    block_threshold?: BlockThreshold
    stopSequences?: string | Array<string>,
    maxOutputTokens?: number,
    temperature?: number,
    topP?: number,
    topK?: number,
}

// these are properties of the OpenAI API
export interface AzureModelSettings extends ModelSettings {
    deploymentId: string,
    azureApiKey: string,
    endpoint: string,
    enableVision? : boolean,
    frequencyPenalty?: number,
    logitBias?: object,
    maxTokens?: number,
    presencePenalty?: number,
    responseFormat?: object,
    stop?: string | Array<string>,
    temperature?: number,
    topP?: number,
    user?: string
}

export interface AzureImageGenSettings extends ModelSettings {
    deploymentId: string,
    azureApiKey: string,
    endpoint: string,
    n?: number,
    size?: string,
    quality?: string,
    style?: string,
    user?: string
}



function extractMarkdownImages(markdownText: string): { updatedText: string; images: { altText: string; imageUrl: string }[] } {
    const imageRegex = /!\[([^[]+)]\((.*?)\)/g;
    let images: { altText: string; imageUrl: string }[] = [];

    // Replace the markdown image syntax and collect image information
    const updatedText = markdownText.replace(imageRegex, (match, altText, imageUrl) => {
        // Add the altText and imageUrl to the images array
        images.push({ altText, imageUrl });
        // Return an empty string to remove the markdown image from the original text
        return '';
    });
    // Return the updated markdown string and the array of image information
    return { updatedText, images };
}



function removeKeys(obj, ...keysToRemove) {
    return Object.keys(obj).reduce((acc, key) => {
        if (!keysToRemove.includes(key)) {
            acc[key] = obj[key];
        }
        return acc;
    }, {});
}

function removeImages(messages : {role: string; content: string;}[])
{
    for (const message of messages) {
        if (message.role === 'user') {
            const { updatedText, images } = extractMarkdownImages(message.content);
            message.content = updatedText;
        }
    }
    return messages;
}

async function handleOpenAIImages(messages : {role: string; content: string | any;}[], enableVision: boolean) {
    
    for (const message of messages) {
        if (message.role === 'user') {
            const { updatedText, images } = extractMarkdownImages(message.content);
            message.content = updatedText;
            if (images.length > 0 && enableVision) {
                message.content = [
                    {type:'text', text:updatedText},
                    ... await Promise.all(images.map(async ({ altText, imageUrl }) => {
                        if (altText === '%%ChatLLM Inline Image') {
                            return { type: "image_url", image_url:{url: imageUrl }};
                        } else if (imageUrl.startsWith("http") || imageUrl.startsWith("https") ) {
                            return { type:"image_url", image_url:{url:imageUrl}};
                        } else {
                            const fileContent = await readFileContent(imageUrl);
                            const serializedData = Buffer.from(fileContent).toString('base64');
                            return { type:"image_url", image_url:{url:"data:image/png;base64," + serializedData}};
                        }
                    }))
                ];
            }
        }
    }
    return messages;
}



export type StreamAsyncGenerator = AsyncGenerator<string | { output_type: string; content: string }, void, unknown>;



export function callChatGPT(messages : {role: string; content: string | any;}[], model: OpenAIModelSettings):
{ stream: StreamAsyncGenerator; abort: () => void; } 
{
    const openai = new OpenAI({
        apiKey: model.api_key,
        ...(model.url !== undefined && { baseURL: model.url })
    }); // Initialize with your API credentials

    
    console.log(messages);


    // Add the current cell content
    let completion : Stream<OpenAI.Chat.Completions.ChatCompletionChunk>;
    const stream = (async function*() {
        try {
            // handle images in the user text
            messages = await handleOpenAIImages(messages, model.enable_vision || false);

            // Call the OpenAI API
            const remainingParams = removeKeys(model, 'name', 'api', 'truncateTokens', 'truncateSysPrompt', 'model', 'api_key', 'url', 'enable_vision');
            completion = await openai.chat.completions.create({
                model: model.model,
                messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                stream: true,
                ...remainingParams
            });


            
            for await (const chunk of completion) {
                const content = chunk.choices[0].delta.content;
                if (content) {
                    yield content;  // Yield each chunk as it arrives
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`OpenAI - error during streaming: ${error}`);
        }
    })();
    
    return {
        stream,
        abort: () => completion.controller.abort()
    };
}


export function callOpenAIImageGen(messages : {role: string; content: string | any;}[], model: OpenAIImageGenSettings):
{ stream: StreamAsyncGenerator; abort: () => void; } 
{
    const openai = new OpenAI({
        apiKey: model.api_key,
        ...(model.url !== undefined && { baseURL: model.url })
    }); // Initialize with your API credentials
    messages = removeImages(messages);

    // Add the current cell content
        const stream = (async function*() {
        try {
            // Call the OpenAI API
            const remainingParams = removeKeys(model, 'name', 'api', 'truncateTokens', 'truncateSysPrompt', 'model', 'api_key', 'url');
            const image = await openai.images.generate({
                model: model.model,
                prompt: messages[messages.length-1]["content"],
                response_format: "b64_json",
                ...remainingParams
            });

            if (image.data[0].b64_json) {
                yield {output_type:"image/png", content:image.data[0].b64_json};
                if (image.data[0].revised_prompt) {
                    yield {output_type:"text/markdown", content:image.data[0].revised_prompt};
                }
            }
            

        } catch (error) {
            vscode.window.showErrorMessage(`OpenAI Image Gen - error during streaming: ${error}`);
        }
    })();
    
    return {
        stream,
        abort: () => {return;}
    };
}



export function callTogether(
    messages: { role: string; content: string; }[],
    model: TogetherModelSettings
): { stream: StreamAsyncGenerator; abort: () => void; }  {
    const url = model.url || 'https://api.together.xyz/v1/completions';


    messages = removeImages(messages);
    
    // Event queue to store messages
    const prompt = messages.map((message, index, arr) => {
        if (message.role === 'system') {
            // For system role, format with system tags
            return `<s>[INST] <<SYS>>${message.content}<</SYS>>\n\n`;
        } else if (message.role === 'user') {
            // For user role, check if the previous message was not a system message
            const previousRole = index > 0 ? arr[index - 1].role : null;
            const startTag = previousRole !== 'system' ? '<s>[INST]' : '';
            return `${startTag}${message.content}[/INST]`;
        } else if (message.role === 'assistant') {
            // For assistant role, just append content with closing tag
            return `${message.content}</s>`;
        }
        // In case of an unknown role, return an empty string or handle as appropriate
        return '';
    }).join(''); // Join all mapped messages into a single string

    const eventQueue : string[] = [];

    if (!globalThis.window) {
        globalThis.window = {
            fetch: globalThis.fetch,
            setTimeout: globalThis.setTimeout,
            clearTimeout: (t) => globalThis.clearTimeout(t),
        } as any;
    }
    if (!globalThis.document) {
        globalThis.document = { removeEventListener: () => {} } as any;
    }

    const remainingParams = removeKeys(model, "name", "api", "truncateTokens", "truncateSysPrompt", "api_key", "url");
    const abortController = new AbortController();
    fetchEventSource(url, {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'content-type': 'application/json',
            //'Authorization': `Bearer ${apiKey}`
            Authorization: `Bearer ${model.api_key}`
        },
        body: JSON.stringify({
            prompt: prompt,
            stream: true,
            ...remainingParams
        }),
        signal: abortController.signal,
        onmessage: (event) => {
            if (event.data === '[DONE]') {
                abortController.abort();
            } else {
                // Push the message into the queue
                const data = JSON.parse(event.data);
                if (data && data.choices && data.choices[0] && data.choices[0].text) {
                    eventQueue.push(data.choices[0].text);
                }
            }
        },
        onclose: () => {
            //console.log('Connection closed by the server');
        },
        onerror: (err) => {
            vscode.window.showErrorMessage(`Together - EventSource failed: ${err}`);
            abortController.abort();
        },
        openWhenHidden: true
    });

    

    async function* generateStream() {
        while (!abortController.signal.aborted) {
            if (eventQueue.length > 0) {
                const message = eventQueue.shift();
                if (message) {
                    yield message;
                }
            } else {
                // Wait for the next message
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        // output the ending messages
        while (eventQueue.length > 0) {
            const message = eventQueue.shift();
            if (message) {
                if (message !== "</s>") {
                    yield message;
                }
            }
        }
    }

    return {
        stream: generateStream(),
        abort: () => {
            abortController.abort();
        }
    };
}





export function callGoogle(messages : {role: string; content: string;}[], model: GoogleModelSettings):
{ stream: StreamAsyncGenerator; abort: () => void; } 
{
    const genAI = new GoogleGenerativeAI(model.api_key);

    messages = removeImages(messages);
    
    const thresholdMap = {
        none: HarmBlockThreshold.BLOCK_NONE,
        high: HarmBlockThreshold.BLOCK_ONLY_HIGH,
        medium: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        low: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE
    };

    const roleMap = {
        "user": "user",
        "assistant": "model"
    };
    

    const safetySettings = [
        {
            category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
            threshold: thresholdMap[model.block_threshold || BlockThreshold.medium]

        },
        {
            category: HarmCategory.HARM_CATEGORY_HARASSMENT,
            threshold: thresholdMap[model.block_threshold || BlockThreshold.medium]

        },
        {
            category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
            threshold: thresholdMap[model.block_threshold || BlockThreshold.medium]

        },
        {
            category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
            threshold: thresholdMap[model.block_threshold || BlockThreshold.medium]
        }
    ];
    const generationConfig = removeKeys(model, 'name', 'api', 'truncateTokens', "truncateSysPrompt", 'model', 'api_key', 'block_threshold');

    const genModel = genAI.getGenerativeModel({model: model.model, 
                                               safetySettings:safetySettings, 
                                               generationConfig:generationConfig});

    // Gemini doesn't have system prompts, put in in the first user prompt
    if (messages[0].role === 'system' && messages.length > 1) {
        messages = [{role:"user", content:messages[0].content + "\n\n" + messages[1].content}, ...messages.slice(2)];
    }
    const pastMessages = messages.map(msg => ({ role: roleMap[msg.role], parts: msg.content }));
    const lastMessage = pastMessages[pastMessages.length-1].parts;
    pastMessages.pop();


    
    // Add the current cell content
    let interrupt : Boolean = false;
    const stream = (async function*() {
        try {
            // Call the Google API, either chat or single generation (such a weird API)
            const remainingParams = removeKeys(model, 'name', 'api', 'truncateTokens', "truncateSysPrompt", 'model', 'api_key');
            let completion : GenerateContentStreamResult;
            if (pastMessages.length > 0) {
                const chat = genModel.startChat({history: pastMessages});
                completion = await chat.sendMessageStream(lastMessage);
            } else {
                completion = await genModel.generateContentStream(lastMessage);
            }
            
            for await (const chunk of completion.stream) {
                if (interrupt) {
                    return;
                }
                const content = chunk.text();
                if (content) {
                    yield content;  // Yield each chunk as it arrives
                }
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Google - Error during streaming: ${error}`);
        }
    })();
    
    return {
        stream,
        abort: () => {interrupt = true;}
    };
}



async function getAzureTokenCredentials() : Promise<TokenCredential | undefined>
{
    const azureAccount = (vscode.extensions.getExtension('ms-vscode.azure-account'));
    if (azureAccount) {
        if (!azureAccount.isActive) {
            await azureAccount.activate();
        }

        const apiAzureAccount = azureAccount.exports;
        if (!(await apiAzureAccount.waitForLogin())) {
            await vscode.commands.executeCommand('azure-account.askForLogin');
        }
        const sessions = await apiAzureAccount.sessions;
        const credentials2 = await apiAzureAccount.sessions[0].credentials2;
        console.log("Credentials ", credentials2);
        console.log("Sessions ", sessions);
        return credentials2;
    } else {
        return undefined;
    }
}

export function callAzure(messages : {role: string; content: string | any;}[], model: AzureModelSettings):
{ stream: StreamAsyncGenerator; abort: () => void; } 
{
    //const client = new OpenAIClient(model.endpoint, new DefaultAzureCredential());
    
    // Add the current cell content
    let completion : any;
    const stream = (async function*() {

        try {
            // load the azure client
            let client;
            if (model.azureApiKey) {
                client = new OpenAIClient(model.endpoint, new AzureKeyCredential(model.azureApiKey));
            } else {
                const tokenCredentials = await getAzureTokenCredentials();
                if (tokenCredentials) {
                    client = new OpenAIClient(model.endpoint, tokenCredentials);
                } else {
                    vscode.window.showErrorMessage(`Azure - You must install the azure-access plugin to use without an API Key.`);
                    return;
                }
            }

            // Call the OpenAI API
            messages = await handleOpenAIImages(messages, model.enableVision || false);
            console.log(messages);

            const remainingParams = removeKeys(model, 'name', 'api', 'truncateTokens', 'truncateSysPrompt', 
                                               'deploymentId', 'azureApiKey', 'endpoint', 'enableVision');

            const completion = await client.streamChatCompletions(
                model.deploymentId, 
                messages as ChatRequestMessage[], 
                remainingParams
            );

            for await (const chunk of completion) {
                if (chunk.choices.length > 0) {
                    const content = chunk.choices[0].delta?.content;
                    if (content) {
                        yield content;  // Yield each chunk as it arrives
                    }
                }
            }
        } catch (error) {
            console.log("Error ", error);
            vscode.window.showErrorMessage(`Azure - error during streaming: ${error}`);
        }
    })();
    
    return {
        stream,
        abort: () => completion.cancel()
    };
}


export function callAzureImageGen(messages : {role: string; content: string | any;}[], model: AzureImageGenSettings):
{ stream: StreamAsyncGenerator; abort: () => void; } 
{
    const client = new OpenAIClient(model.endpoint, new AzureKeyCredential(model.azureApiKey));
    messages = removeImages(messages);

    let completion : any;
    // Add the current cell content
    const stream = (async function*() {
        try {
            // Call the OpenAI API
            const remainingParams = removeKeys(model, 'name', 'api', 'truncateTokens', 'truncateSysPrompt','deploymentId', 'azureApiKey', 'endpoint');


            const image = await client.getImages(
                model.deploymentId, 
                messages[messages.length-1]["content"], 
                {responseFormat: "b64_json", ...remainingParams}
            );

            if (image.data[0].base64Data) {
                yield {output_type:"image/png", content:image.data[0].base64Data};
                if (image.data[0].revisedPrompt) {
                    yield {output_type:"text/markdown", content:image.data[0].revisedPrompt};
                }
            }
            

        } catch (error) {
            vscode.window.showErrorMessage(`OpenAI Image Gen - error during streaming: ${error}`);
        }
    })();
    
    return {
        stream,
        abort: () => {return;}
    };
}

