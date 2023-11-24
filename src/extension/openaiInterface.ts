import * as vscode from 'vscode';
import OpenAI from 'openai';


const config = vscode.workspace.getConfiguration('chatllm');

export function callChatGPT(messages : {role: string; content: string;}[]):
{ stream: AsyncGenerator<string, void, unknown>; abort: () => void; } 
{
    const apiKey = config.get<string>('openaiApiKey');
    const openai = new OpenAI({apiKey:apiKey}); // Initialize with your API credentials
    
    // Add the current cell content
    let completion : any;
    const stream = (async function*() {
        try {
            // Call the OpenAI API
            completion = await openai.chat.completions.create({
                model: config.get<string>('modelName') || 'gpt-3.5-turbo',
                messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
                stream: true,
            });
            
            for await (const chunk of completion) {
                const content = chunk.choices[0].delta.content;
                if (content) {
                    yield content;  // Yield each chunk as it arrives
                }
            }
        } catch (error) {
            console.error('Error during streaming:', error);
        }
    })();
    
    return {
        stream,
        abort: () => completion.controller.abort()
    };
}

