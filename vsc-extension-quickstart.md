# Welcome to your VS Code Extension

## What's in the folder

* This folder contains all of the files necessary for your extension.
* `package.json` - this is the manifest file in which you declare your extension and command.
  * The sample plugin registers a command and defines its title and command name. With this information VS Code can show the command in the command palette. It doesn’t yet need to load the plugin.
* `src/extension.ts` - this is the main file where you will provide the implementation of your command.
  * The file exports one function, `activate`, which is called the very first time your extension is activated (in this case by executing the command). Inside the `activate` function we call `registerCommand`.
  * We pass the function containing the implementation of the command as the second parameter to `registerCommand`.

## Get up and running straight away

* Press `F5` to open a new window with your extension loaded.
* Run your command from the command palette by pressing (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) and typing `Hello World`.
* Set breakpoints in your code inside `src/extension.ts` to debug your extension.
* Find output from your extension in the debug console.

## Make changes

* You can relaunch the extension from the debug toolbar after changing code in `src/extension.ts`.
* You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load your changes.

## Explore the API

* You can open the full set of our API when you open the file `node_modules/@types/vscode/index.d.ts`.

## Run tests

* Open the debug viewlet (`Ctrl+Shift+D` or `Cmd+Shift+D` on Mac) and from the launch configuration dropdown pick `Extension Tests`.
* Press `F5` to run the tests in a new window with your extension loaded.
* See the output of the test result in the debug console.
* Make changes to `src/test/suite/extension.test.ts` or create new test files inside the `test/suite` folder.
  * The provided test runner will only consider files matching the name pattern `**.test.ts`.
  * You can create folders inside the `test` folder to structure your tests any way you want.

## Go further

* [Follow UX guidelines](https://code.visualstudio.com/api/ux-guidelines/overview) to create extensions that seamlessly integrate with VS Code's native interface and patterns.
 * Reduce the extension size and improve the startup time by [bundling your extension](https://code.visualstudio.com/api/working-with-extensions/bundling-extension).
 * [Publish your extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) on the VS Code extension marketplace.
 * Automate builds by setting up [Continuous Integration](https://code.visualstudio.com/api/working-with-extensions/continuous-integration).


The time complexity of the Sieve of Eratosthenes algorithm can be analyzed by considering the number of times each inner loop runs across all iterations. The main for loop runs from 2 up to \( n \), and for each prime \( p \), the inner loop marks multiples of \( p \) starting from \( p^2 \) up to \( n \). This inner loop runs approximately \( \frac{n}{p} \) times for each prime \( p \).

Since the algorithm processes each multiple of each prime number exactly once, the number of operations is proportional to the sum of the series:

\[
\sum_{p \in primes} \frac{n}{p}
\]

where \( primes \) is the set of prime numbers less than \( n \). An upper bound for this sum is given by:

\[
n \left(\frac{1}{2} + \frac{1}{3} + \frac{1}{5} + \frac{1}{7} + \dotsb \right) = n (\log \log n + O(1)) 
\]

according to the prime number theorem, where \( \log \log n \) is the natural logarithm of the natural logarithm of \( n \). The \( O(1) \) term is a constant that accounts for the non-regular terms in the sum.

Therefore, the overall time complexity of the Sieve of Eratosthenes is:

\[
O(n \log \log n)
\]

This makes the Sieve of Eratosthenes an efficient algorithm for generating all prime numbers up to \( n \), especially when compared to more naive methods of checking each number for primality individually, which could result in a time complexity of:

\[
O(n \sqrt{n})
\]

or worse, depending on the primality test used.