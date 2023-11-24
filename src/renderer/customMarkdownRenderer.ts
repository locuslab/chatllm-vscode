import markdownIt from 'markdown-it';
import markdownItMathjax3 from 'markdown-it-mathjax3';
import markdownItHighlightJS from 'markdown-it-highlightjs';
import type { ActivationFunction, RendererContext } from 'vscode-notebook-renderer';

import "../../node_modules/highlight.js/styles/atom-one-dark.css";

// Initialize markdown-it with texmath plugin
const md = markdownIt().use(markdownItMathjax3).use(markdownItHighlightJS, {});

export const activate: ActivationFunction = context => {
    return {
        renderOutputItem(data, element) {
            // Render markdown content
            //const renderedContent = md.render();

            // Set the innerHTML of the element to the rendered markdown
            
            element.innerHTML = md.render(data.text()
                                          .replace(/\\\[/g,'$$$$')
                                          .replace(/\\\]/g,'$$$$')
                                          .replace(/\\\(\s*/g,'$')
                                          .replace(/\s*\\\)/g,'$'));

        }
    };
};