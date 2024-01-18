import markdownIt from 'markdown-it';
import markdownItMathjax3 from 'markdown-it-mathjax3';
import markdownItHighlightJS from 'markdown-it-highlightjs';
import type { ActivationFunction, RendererContext } from 'vscode-notebook-renderer';


import "./style.css";

// Initialize markdown-it with texmath plugin
const md = markdownIt().use(markdownItMathjax3).use(markdownItHighlightJS, {});

export const activate: ActivationFunction = (context) => {
    return {
        renderOutputItem(data, element) {
            
            //const renderedContent = md.render();
            
            // Set the innerHTML of the element to the rendered markdown


            let markdownText = data.text();

            // Goal here is to replace \[ \]-style equations with $$ $$, which appears to be what markdown-it displays
            // But it's not working for now, and interferes with code too much, so we'll just remove it for now. TODO

            // const codeSegments : string[] = [];
            // const placeholder = 'CODE_SEGMENT_PLACEHOLDER';
            
            // // Find sequences of backtick blocks (closed or not closed), and inline backticks
            // markdownText = markdownText.replace(/(```[\s\S]*?(?:```|$))|(`[\s\S]*?(?:`|$))/gm, match => {
            //     codeSegments.push(match);
            //     return placeholder;
            // });

            // // Perform substitutions on the rest of the text
            // markdownText = (markdownText.replace(/\\\[/g,'$$$$')
            //                     .replace(/\\\]/g,'$$$$')
            //                     .replace(/\\\(\s*/g,'$')
            //                     .replace(/\s*\\\)/g,'$'));

            // // Restore the code segments
            // codeSegments.forEach(segment => {
            //     markdownText = markdownText.replace(placeholder, segment);
            // });
            
            
            const formattedHTML = md.render(markdownText);
                                            

            if (context.postMessage) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(formattedHTML, 'text/html');
                const codeBlocks = doc.querySelectorAll('pre code');
                
                codeBlocks.forEach((codeBlock) => {
                    const header = doc.createElement('div');
                    header.className = 'code-header';
                    const link = doc.createElement('a');
                    link.className = 'copy-link';
                    link.textContent = 'Copy';
                    //link.style.cursor = 'pointer'; // Make it look clickable
                    header.appendChild(link);
                    codeBlock.parentNode?.insertBefore(header, codeBlock);
                });
                element.innerHTML = doc.body.innerHTML;


                // Now, we need to attach the event listeners to the actual buttons in the DOM
                const newLinks = element.querySelectorAll('.copy-link');
                newLinks.forEach((newLink, index) => {
                    // Assuming buttons and codeBlocks arrays are indexed in the same order
                    const codeBlock = codeBlocks[index];
                    newLink.addEventListener('click', () => {
                        context.postMessage!({request: "copyText", data: codeBlock.textContent || ""});
                        newLink.textContent = 'Copied!';
                        setTimeout(() => (newLink.textContent = 'Copy'), 2000);
                    });
                });

            } else {
                element.innerHTML = formattedHTML;
            }
            
        }
    };
};