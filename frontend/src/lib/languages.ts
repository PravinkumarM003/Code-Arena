export interface LanguageConfig {
  id: string;
  label: string;
  monaco: string;
  ext: string;
  template: string;
}

export const LANGUAGES: LanguageConfig[] = [
  {
    id: 'CPP',
    label: 'C++',
    monaco: 'cpp',
    ext: 'cpp',
    template: `#include <iostream>
using namespace std;

int main() {
    // Write C++ code here
    cout << "Hello World from CodeArena Compiler!" << endl;
    return 0;
}
`,
  },
  {
    id: 'C',
    label: 'C',
    monaco: 'c',
    ext: 'c',
    template: `#include <stdio.h>

int main() {
    // Write C code here
    printf("Hello World from CodeArena Compiler!\\n");
    return 0;
}
`,
  },
  {
    id: 'PYTHON',
    label: 'Python 3',
    monaco: 'python',
    ext: 'py',
    template: `# CodeArena Python 3 Compiler
def main():
    print("Hello World from CodeArena Compiler!")

if __name__ == "__main__":
    main()
`,
  },
  {
    id: 'JAVA',
    label: 'Java',
    monaco: 'java',
    ext: 'java',
    template: `public class Main {
    public static void main(String[] args) {
        // Write Java code here
        System.out.println("Hello World from CodeArena Compiler!");
    }
}
`,
  },
  {
    id: 'JAVASCRIPT',
    label: 'JavaScript',
    monaco: 'javascript',
    ext: 'js',
    template: `// CodeArena JavaScript Compiler
function main() {
    console.log("Hello World from CodeArena Compiler!");
}

main();
`,
  },
  {
    id: 'TYPESCRIPT',
    label: 'TypeScript',
    monaco: 'typescript',
    ext: 'ts',
    template: `// CodeArena TypeScript Compiler
const message: string = "Hello World from CodeArena Compiler!";
console.log(message);
`,
  },
  {
    id: 'CSHARP',
    label: 'C#',
    monaco: 'csharp',
    ext: 'cs',
    template: `using System;

class Program {
    static void Main() {
        // Write C# code here
        Console.WriteLine("Hello World from CodeArena Compiler!");
    }
}
`,
  },
  {
    id: 'GO',
    label: 'Go',
    monaco: 'go',
    ext: 'go',
    template: `package main

import "fmt"

func main() {
    // Write Go code here
    fmt.Println("Hello World from CodeArena Compiler!")
}
`,
  },
  {
    id: 'RUST',
    label: 'Rust',
    monaco: 'rust',
    ext: 'rs',
    template: `fn main() {
    // Write Rust code here
    println!("Hello World from CodeArena Compiler!");
}
`,
  },
  {
    id: 'PHP',
    label: 'PHP',
    monaco: 'php',
    ext: 'php',
    template: `<?php
// Write PHP code here
echo "Hello World from CodeArena Compiler!\\n";
?>
`,
  },
];
