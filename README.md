# chatllm-vscode README

ChatLLM is a VSCode extension for interacting with LLM APIs in a flexible and long-form manner.  It leverages the VSCode notebook support to do so, creating a new type of notebook (.chatllm) files where you can interact with an (API-based) LLM system over a long document.

## Motivation

For the most part, I think that people are using LLMs suboptimally, especially as far as integration into IDEs goes.  There are no shortage of "talk to ChatGPT"-type plugins for VSCode, and GitHub Co-pilot has chat functionality too, but these methods all seem to prioritize short-term one-off questions and code generation rather than long form interaction.

In my experience, the best way to leverage LLMs (for most tasks, but very much thinking of coding as the primary example) is via long-form interaction, thinking of chat logs as "projects" that evolve over long periods of time.  But at the same time, most public interfaces for LLMs are set up quite badly for this: many can't handle long projects at all (they fail to handle truncation, etc), and even the ChatGPT interface, which I usually would up using before, gets extremely laggy as you build a long chat.

Fortunately, the IDE we're virtually all using already has a perfectly good interface to accomplish this goal, the notebook interface.  I'm writing this as a VSCode plugin instead of e.g. a Jupyter notebook cell magic, (which does also exist incidentally), largely because I want to do development inside an actual IDE.  And while it might make sense to embed these into Jupyter notebooks with an actual Python kernel, in practice I _don't_ want most development work to happen in a notebook, and would rather have a more specific interface that _only_ handles LLMs.

## Installation and setup

Describe specific features of your extension including screenshots of your extension in action. Image paths are relative to this README file.

For example if there is an image subfolder under your extension project workspace:

\!\[feature X\]\(images/feature-x.png\)

> Tip: Many popular extensions utilize animations. This is an excellent way to show off your extension! We recommend short, focused animations that are easy to follow.

## Requirements

If you have any requirements or dependencies, add a section describing those and how to install and configure them.

## Extension Settings

Include if your extension adds any VS Code settings through the `contributes.configuration` extension point.

For example:

This extension contributes the following settings:

* `myExtension.enable`: Enable/disable this extension.
* `myExtension.thing`: Set to `blah` to do something.

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...