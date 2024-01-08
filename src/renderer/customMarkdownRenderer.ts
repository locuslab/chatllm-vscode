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
            // Render markdown content
            //const renderedContent = md.render();
            
            // Set the innerHTML of the element to the rendered markdown
            
            const formattedHTML = md.render(data.text()
                                            .replace(/\\\[/g,'$$$$')
                                            .replace(/\\\]/g,'$$$$')
                                            .replace(/\\\(\s*/g,'$')
                                            .replace(/\s*\\\)/g,'$'));

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