const { getDb } = require('./schema');
const config = require('../utils/config');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Complete 19 Core eBooks Catalog Specification with Covers and Google Drive Links
const booksCatalog = [
  {
    title: 'HTML & CSS',
    slug: 'html-css',
    price: 9900,
    category: 'web-development',
    rating: 4.8,
    cover_image: '/uploads/covers/cover_37acae95-a434-49fc-aae6-a70dd83ca529_1790946119160.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1QA_E2E_TEST_FOLDER_LINK',
    short_description: 'Master modern semantic HTML5 and advanced CSS3 layout techniques including Flexbox and Grid.',
    description: 'The definitive handbook to building modern, accessible, responsive websites from scratch. Learn responsive design principles, CSS animations, CSS Grid, Flexbox, custom properties, and cross-browser compatibility.',
    what_you_learn: [
      'Semantic HTML5 structure and SEO markup',
      'Modern CSS3 layouts with Flexbox and CSS Grid',
      'Responsive mobile-first web design',
      'CSS variables, animations, and transitions',
      'Web accessibility (a11y) standards and best practices',
      'Building 3 complete real-world responsive websites'
    ],
    topics: ['HTML5 Semantics', 'CSS Box Model', 'Flexbox Deep Dive', 'CSS Grid Systems', 'Responsive Breakpoints', 'CSS Animations', 'Form Validation & UI']
  },
  {
    title: 'C',
    slug: 'c-programming',
    price: 9900,
    category: 'programming-languages',
    rating: 4.9,
    cover_image: '/uploads/covers/cover_c6be2248-de3b-4c76-8b58-34a18a46cf0e_1790946161244.png',
    google_drive_url: '',
    short_description: 'Core concepts of C programming: pointers, memory management, and system-level programming.',
    description: 'Master the foundational language of computer science. Understand memory pointers, structs, file I/O, bitwise operators, dynamic memory allocation, and how code interacts directly with computer hardware.',
    what_you_learn: [
      'Fundamental syntax, data types, and control flow in C',
      'Mastering pointers, memory addresses, and pointer arithmetic',
      'Dynamic memory allocation (malloc, calloc, realloc, free)',
      'Structs, unions, and custom data structures',
      'File input/output operations and binary manipulation',
      'Low-level system programming and debugging with GDB'
    ],
    topics: ['C Syntax & Types', 'Pointers & Memory', 'Dynamic Allocation', 'Structs & Unions', 'File I/O', 'Preprocessor & Macros', 'Memory Leak Prevention']
  },
  {
    title: 'C++',
    slug: 'cpp-programming',
    price: 14900,
    category: 'programming-languages',
    rating: 4.9,
    cover_image: '/uploads/covers/cover_2fed5d4b-e25e-479d-938c-466bfdb8dd18_1790946200377.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1uLKerFe6MJuiJ6lgOxvu6WT08rBg3sTC?usp=drive_link',
    short_description: 'Modern C++ from fundamentals to advanced OOP, templates, and the Standard Template Library (STL).',
    description: 'Comprehensive guide to Modern C++ (C++17/20). Covers object-oriented design, RAII, smart pointers, templates, lambda expressions, concurrency, and high-performance programming.',
    what_you_learn: [
      'Object-oriented programming (Classes, Inheritance, Polymorphism)',
      'Modern C++ features (auto, lambdas, move semantics, smart pointers)',
      'Standard Template Library (STL) algorithms and containers',
      'Template metaprogramming and generic design',
      'Exception handling and RAII resource management',
      'Building high-performance system applications'
    ],
    topics: ['OOP Fundamentals', 'Smart Pointers & RAII', 'Move Semantics', 'STL Containers & Iterators', 'Templates & Generics', 'Multithreading & Concurrency', 'Modern C++ Best Practices']
  },
  {
    title: 'Java',
    slug: 'java-programming',
    price: 9900,
    category: 'programming-languages',
    rating: 4.8,
    cover_image: '/uploads/covers/cover_a90963a9-ce0b-438b-80ab-a82df3b7311d_1790946232212.png',
    google_drive_url: 'https://drive.google.com/drive/folders/11qu4IaEGZM3tsQg5_uqb9ZxNjg4Za8w8?usp=drive_link',
    short_description: 'Comprehensive Java programming from object-oriented basics to streams and multithreading.',
    description: 'Learn enterprise-grade Java development. Explore the JVM, collections framework, lambda expressions, Stream API, exception handling, file I/O, and concurrent programming.',
    what_you_learn: [
      'Core Java fundamentals and OOP principles',
      'Java Collections Framework (List, Set, Map, Queue)',
      'Functional programming with Lambdas and Stream API',
      'Multithreading, thread safety, and executor services',
      'Java I/O, NIO.2, and serialization',
      'Unit testing with JUnit and clean coding conventions'
    ],
    topics: ['JVM Architecture', 'OOP in Java', 'Collections Framework', 'Lambdas & Streams', 'Concurrency & Threads', 'Exception Handling', 'Generics & Annotations']
  },
  {
    title: 'JavaScript',
    slug: 'javascript',
    price: 14900,
    category: 'web-development',
    rating: 4.9,
    cover_image: '/uploads/covers/cover_827316b2-55ca-44fa-93e5-9fdbaae89bed_1790946275648.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1tkNbuMK8RUQje79ptVuZyf8NDOJk-TKz?usp=drive_link',
    short_description: 'Deep dive into Modern JavaScript (ES6+), async programming, closures, and the event loop.',
    description: 'The ultimate guide to mastering JavaScript. Demystify scopes, closures, prototypes, asynchronous patterns (Promises, async/await), DOM manipulation, modules, and browser APIs.',
    what_you_learn: [
      'JavaScript execution context, call stack, and Event Loop',
      'Closures, lexical scoping, and prototype chains',
      'Modern ES6+ syntax, destructuring, modules, and classes',
      'Asynchronous JavaScript with Promises and async/await',
      'DOM manipulation, event delegation, and browser performance',
      'Design patterns and writing scalable frontend code'
    ],
    topics: ['Event Loop & Async', 'Closures & Scopes', 'Prototypes & Classes', 'Promises & Async/Await', 'ESNext Features', 'DOM & Events', 'Design Patterns']
  },
  {
    title: 'Node.js',
    slug: 'nodejs',
    price: 9900,
    category: 'web-development',
    rating: 4.8,
    cover_image: '/uploads/covers/cover_78ac94bf-6454-4efb-a1fc-180479524ce2_1790946341617.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1M3NTgF1LK7gcAdAGXb3KbLT-9SXKGbhp?usp=drive_link',
    short_description: 'Build fast, scalable backend APIs and microservices using Node.js and Express.',
    description: 'Master server-side JavaScript development. Build RESTful APIs, manage authentication, stream large files, interact with databases, handle websockets, and deploy production-ready applications.',
    what_you_learn: [
      'Node.js architecture, libuv, and non-blocking I/O',
      'Building secure REST APIs with Express.js',
      'Authentication with JWT, bcrypt, and session management',
      'Database integration, ORMs, and query optimization',
      'Streams, buffers, and handling file uploads',
      'Error handling, logging, rate limiting, and security best practices'
    ],
    topics: ['Node Runtime & Event Loop', 'Express.js Framework', 'REST API Architecture', 'JWT Authentication', 'Streams & Buffers', 'API Security & Helmet', 'Production Deployment']
  },
  {
    title: 'Python',
    slug: 'python-programming',
    price: 14900,
    category: 'programming-languages',
    rating: 4.9,
    cover_image: '/uploads/covers/cover_4dd4b9fd-37d4-4ab3-b6c3-0c846de00842_1790946375416.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1V7g7LQGQsUwwRy6jI75C3zwFqeltBPFt?usp=drive_link',
    short_description: 'From zero to Python mastery: clean code, data structures, OOP, modules, and automation.',
    description: 'The complete guide to Python programming. Master idiomatic Python (Pythonic code), list comprehensions, decorators, generators, OOP, file handling, testing, and real-world automation scripts.',
    what_you_learn: [
      'Core Python syntax, data structures, and algorithms',
      'Writing clean, Pythonic code and list/dict comprehensions',
      'Advanced functions, decorators, closures, and generators',
      'Object-oriented programming and magic (dunder) methods',
      'File handling, JSON/CSV parsing, and regular expressions',
      'Web scraping, automation scripts, and unit testing with pytest'
    ],
    topics: ['Pythonic Syntax', 'Decorators & Generators', 'Object-Oriented Python', 'Modules & Packages', 'File & Data Processing', 'Automation & Scripting', 'Error Handling & PyTest']
  },
  {
    title: 'NumPy',
    slug: 'numpy',
    price: 9900,
    category: 'data-science',
    rating: 4.7,
    cover_image: '/uploads/covers/cover_3b8140a5-7095-441a-bf54-9bdff5bf1f76_1790946415817.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1xBYWIZRfet0e3Ow6F7hxuY-Iby9SR9CX?usp=drive_link',
    short_description: 'High-performance numerical computing and multidimensional array manipulation with NumPy.',
    description: 'Essential NumPy handbook for data science and machine learning. Learn N-dimensional array creation, vectorization, broadcasting, matrix arithmetic, linear algebra, and mathematical operations.',
    what_you_learn: [
      'NumPy N-dimensional array (ndarray) creation and indexing',
      'Vectorized computations and eliminating Python loops',
      'Array slicing, reshaping, stacking, and broadcasting rules',
      'Mathematical, statistical, and random number routines',
      'Linear algebra operations, dot products, and matrix inversions',
      'Performance benchmarking and memory layout (C vs Fortran order)'
    ],
    topics: ['NDArrays & Data Types', 'Array Indexing & Slicing', 'Vectorization & Broadcasting', 'Linear Algebra (np.linalg)', 'Statistical Functions', 'Random Sampling', 'Memory Optimization']
  },
  {
    title: 'Pandas',
    slug: 'pandas',
    price: 9900,
    category: 'data-science',
    rating: 4.8,
    cover_image: '/uploads/covers/cover_f859f21d-effe-466b-88bd-4f0a82cfc443_1790946480197.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1WXJTerbPsSFH6DazKqzdOHcJfTPDoMRK?usp=drive_link',
    short_description: 'Data analysis, data wrangling, cleaning, and transformation using Python Pandas.',
    description: 'The comprehensive guide to data wrangling and analysis with Pandas. Master DataFrames, Series, missing data handling, grouping, aggregating, merging datasets, time series, and data visualization.',
    what_you_learn: [
      'DataFrames and Series data structures and indexing',
      'Data importing/exporting (CSV, Excel, SQL, JSON, Parquet)',
      'Data cleaning, missing value imputation, and outlier detection',
      'Grouping, aggregating, pivot tables, and crosstabs',
      'Merging, joining, and concatenating complex datasets',
      'Time series analysis, date formatting, and window calculations'
    ],
    topics: ['Series & DataFrames', 'Filtering & Selection (loc/iloc)', 'Data Cleaning & Imputation', 'GroupBy & Aggregations', 'Merging & Joining', 'Time Series Analysis', 'Performance Tips']
  },
  {
    title: 'Generative AI',
    slug: 'generative-ai',
    price: 14900,
    category: 'ai',
    rating: 4.9,
    cover_image: '/uploads/covers/cover_8f1da331-f735-4b0e-a7ff-aa3528a2a4e4_1790946519374.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1_nPr441F8xHvVlSe36OJ52j3-xcNH3eY?usp=drive_link',
    short_description: 'Practical guide to LLMs, prompt engineering, RAG pipelines, and AI agent architectures.',
    description: 'Explore the modern landscape of Generative AI. Learn how Large Language Models work, master prompt engineering, build Retrieval-Augmented Generation (RAG) systems with vector databases, and build autonomous AI agents.',
    what_you_learn: [
      'Transformer architecture, attention mechanisms, and LLM foundations',
      'Advanced prompt engineering and structured output generation',
      'Building RAG pipelines using embeddings and vector search',
      'Function calling, tool integration, and multimodal workflows',
      'Building autonomous AI agents with memory and reasoning loops',
      'Fine-tuning strategies, evaluation frameworks, and AI safety'
    ],
    topics: ['LLM Architectures', 'Prompt Engineering', 'Vector Embeddings & Search', 'RAG Pipelines', 'Function Calling & Tools', 'Autonomous Agents', 'Model Evaluation & Deployment']
  },
  {
    title: 'SQL',
    slug: 'sql',
    price: 14900,
    category: 'database',
    rating: 4.9,
    cover_image: '/uploads/covers/cover_f1ba6800-4466-4710-91a9-7d1862484226_1790946570397.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1z1AhCDK8x-C1goXb-M65ikd7UsTcwjAv?usp=drive_link',
    short_description: 'Write fast, complex SQL queries: joins, subqueries, CTEs, window functions, and indexing.',
    description: 'Master relational database querying. From basic SELECT statements to complex multi-table joins, Common Table Expressions (CTEs), window functions, query execution plan analysis, and performance tuning.',
    what_you_learn: [
      'Database querying from fundamentals to advanced SQL',
      'Inner, left, right, full outer, and cross joins',
      'Aggregations, GROUP BY, HAVING, and set operations',
      'Window functions (ROW_NUMBER, RANK, LAG, LEAD, moving averages)',
      'Common Table Expressions (CTEs) and recursive queries',
      'Indexing strategies, query optimization, and EXPLAIN plans'
    ],
    topics: ['Relational SQL Basics', 'Complex Joins', 'Window Functions', 'Subqueries & CTEs', 'Query Optimization', 'Indexes (B-Tree/Hash)', 'Transactions & ACID']
  },
  {
    title: 'DBMS',
    slug: 'dbms',
    price: 14900,
    category: 'database',
    rating: 4.8,
    cover_image: '/uploads/covers/cover_4c90124f-b309-41bd-91e8-7f6e00873657_1790946605852.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1WpZDHfzAYy69oCixK7Q0r0eW9tM8WpvE?usp=drive_link',
    short_description: 'Database Management Systems architecture, relational modeling, normalization, and ACID.',
    description: 'In-depth guide to Database Management Systems. Understand ER diagrams, relational algebra, 1NF-BCNF normalization, transaction management, concurrency control protocols, and recovery systems.',
    what_you_learn: [
      'DBMS architectures, 3-tier models, and data independence',
      'Entity-Relationship (ER) modeling and schema design',
      'Relational algebra and relational calculus',
      'Database normalization (1NF, 2NF, 3NF, BCNF) and dependency theory',
      'Transaction processing, ACID properties, and serializability',
      'Locking mechanisms, two-phase locking, deadlock handling, and WAL logs'
    ],
    topics: ['DBMS Architecture', 'ER Modeling', 'Relational Algebra', 'Normalization (1NF-BCNF)', 'ACID Transactions', 'Concurrency Control & Locks', 'Crash Recovery']
  },
  {
    title: 'DSA',
    slug: 'dsa',
    price: 9900,
    category: 'computer-science',
    rating: 4.9,
    cover_image: '/uploads/covers/cover_d5d0ce57-0e92-4eb0-83ee-d14e92e92b2e_1790946640408.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1vY-3B3YQSo-z7tPcLYN5vRKLJuIjE_TF?usp=drive_link',
    short_description: 'Data Structures & Algorithms: Arrays, Linked Lists, Trees, Graphs, Dynamic Programming.',
    description: 'Crack coding interviews and master computer science fundamentals. Detailed visual explanations and code implementations of all key data structures and algorithmic paradigms with Big-O complexity analysis.',
    what_you_learn: [
      'Time and space complexity analysis (Big-O, Big-Omega, Big-Theta)',
      'Arrays, Linked Lists, Stacks, Queues, and Hash Tables',
      'Trees, Binary Search Trees, AVL Trees, Heaps, and Tries',
      'Graph algorithms (BFS, DFS, Dijkstra, Bellman-Ford, Kruskal)',
      'Algorithm paradigms (Greedy, Divide & Conquer, Backtracking)',
      'Dynamic Programming patterns (Knapsack, LCS, LIS, Interval DP)'
    ],
    topics: ['Asymptotic Analysis', 'Linear Data Structures', 'Trees & Heaps', 'Graph Algorithms', 'Searching & Sorting', 'Dynamic Programming', 'Interview Problem Patterns']
  },
  {
    title: 'Operating System',
    slug: 'operating-system',
    price: 9900,
    category: 'computer-science',
    rating: 4.8,
    cover_image: '/uploads/covers/cover_f7177980-0eaf-422b-9453-823e82c70bd6_1790946694092.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1Ufagtr9RNofKuYk2VDf9NSq1MQzBAHka?usp=sharing',
    short_description: 'Operating Systems concepts: processes, threads, CPU scheduling, synchronization, and memory.',
    description: 'Understand how modern operating systems operate. Covers process management, CPU scheduling algorithms, inter-process communication, semaphores, mutexes, virtual memory, paging, and file systems.',
    what_you_learn: [
      'Kernel architecture, system calls, and dual-mode operation',
      'Process lifecycle, threads, and context switching',
      'CPU scheduling algorithms (FCFS, SJF, Round Robin, Priority)',
      'Process synchronization, race conditions, semaphores, and monitors',
      'Deadlock prevention, detection, and avoidance (Banker\'s Algorithm)',
      'Memory management, paging, segmentation, and virtual memory page replacement'
    ],
    topics: ['OS Kernels & Syscalls', 'Processes & Threads', 'CPU Scheduling', 'Synchronization & Deadlocks', 'Virtual Memory & Paging', 'File Systems & Storage', 'Linux OS Internals']
  },
  {
    title: 'Computer Network',
    slug: 'computer-network',
    price: 9900,
    category: 'computer-science',
    rating: 4.8,
    cover_image: '/uploads/covers/cover_48074f71-152c-402d-ab6d-3673ae27d89b_1790946745683.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1-DowCBIwBUf5ThRop28r5ClL1vTpq9NS?usp=drive_link',
    short_description: 'OSI model, TCP/IP protocol suite, DNS, HTTP/HTTPS, routing algorithms, and network security.',
    description: 'Complete guide to computer networking. Learn how data travels across the Internet, deep dive into the OSI and TCP/IP models, routing protocols, subnetting, transport layer mechanics, and network security.',
    what_you_learn: [
      'OSI 7-layer and TCP/IP 4-layer network models',
      'Application layer protocols (HTTP/1.1, HTTP/2, HTTP/3, DNS, SMTP, FTP)',
      'Transport layer (TCP 3-way handshake, flow control, congestion control, UDP)',
      'Network layer (IPv4/IPv6 addressing, subnetting, CIDR, ARP, ICMP)',
      'Routing algorithms (Distance Vector, Link State, OSPF, BGP)',
      'Network security (TLS/SSL handshakes, Firewalls, VPNs, and NAT)'
    ],
    topics: ['OSI & TCP/IP Models', 'Application Layer & HTTP', 'TCP vs UDP Deep Dive', 'IPv4/IPv6 & Subnetting', 'Routing & Switching', 'TLS/SSL Encryption', 'Network Troubleshooting']
  },
  {
    title: 'Computer Architecture',
    slug: 'computer-architecture',
    price: 9900,
    category: 'computer-science',
    rating: 4.7,
    cover_image: '/uploads/covers/cover_17ead4d8-cbd6-45a4-ba9a-dbd635491f35_1790946786396.png',
    google_drive_url: 'https://drive.google.com/drive/folders/1ejkZDnpty4-BZk3CaYvO_UnpfWvZbLq2?usp=drive_link',
    short_description: 'CPU design, instruction sets, pipelining, cache memory hierarchies, and digital logic.',
    description: 'Explore the hardware-software boundary. Learn digital logic design, ALU architecture, RISC vs CISC instruction sets, CPU pipelining, branch prediction, cache hierarchies, and multicore systems.',
    what_you_learn: [
      'Digital logic gates, boolean algebra, and combinational/sequential circuits',
      'Von Neumann and Harvard architectures',
      'Instruction Set Architecture (ISA): RISC vs CISC (x86 vs ARM)',
      'Instruction pipelining, pipeline hazards, and branch prediction',
      'Memory hierarchy: L1/L2/L3 caches, cache coherence protocols (MESI)',
      'I/O interfacing, DMA, interrupts, and superscalar multicore processing'
    ],
    topics: ['Digital Logic Design', 'CPU Architecture', 'Instruction Sets (ISA)', 'Pipelining & Hazards', 'Cache Memory & RAM', 'Virtual Memory Translation', 'Multicore & Parallelism']
  },
  {
    title: 'Excel',
    slug: 'excel',
    price: 9900,
    category: 'productivity',
    rating: 4.8,
    cover_image: '/uploads/covers/cover_ed4c6c1d-28e6-4def-905d-5ef44224c37e_1790946820285.jpg',
    google_drive_url: 'https://drive.google.com/drive/folders/1aokIezMXnBOWAbaHMlqB-aNNrsdxTnvk?usp=drive_link',
    short_description: 'Master Microsoft Excel: advanced formulas, XLOOKUP, PivotTables, dashboard design, and automation.',
    description: 'The ultimate Excel power guide. Learn data organization, advanced formulas (XLOOKUP, INDEX/MATCH, dynamic arrays), data validation, PivotTables, charts, interactive dashboards, and Power Query.',
    what_you_learn: [
      'Modern Excel interface, shortcuts, and formula essentials',
      'Advanced lookup formulas: XLOOKUP, INDEX/MATCH, FILTER, UNIQUE',
      'Data cleaning, transformation, and automated workflows with Power Query',
      'PivotTables, PivotCharts, Slicers, and calculated fields',
      'Building dynamic, interactive business KPI dashboards',
      'Conditional formatting, data validation, and error auditing'
    ],
    topics: ['Formulas & Functions', 'Modern Lookups (XLOOKUP)', 'PivotTables & Slicers', 'Interactive Dashboards', 'Power Query Essentials', 'Data Validation & Auditing', 'Productivity Shortcuts']
  },
  {
    title: 'Android',
    slug: 'android-development',
    price: 9900,
    category: 'mobile-development',
    rating: 4.8,
    cover_image: '/uploads/covers/cover_695ba46c-d1c6-4a1a-945b-4f1386b34d89_1790946852325.jpg',
    google_drive_url: 'https://drive.google.com/drive/folders/1xmavrMGEnchapu3p7Mysawne2ICuHqb9?usp=drive_link',
    short_description: 'Modern Android app development using Kotlin, Jetpack Compose, MVVM, Coroutines, and Room.',
    description: 'Learn modern Android application development from ground up. Build reactive user interfaces using Jetpack Compose, architecture apps with MVVM/Clean Architecture, manage state, handle REST APIs with Retrofit, and persist data with Room.',
    what_you_learn: [
      'Kotlin language fundamentals for Android development',
      'Declarative UI building with Jetpack Compose',
      'Android Architecture Components (ViewModel, StateFlow, LiveData)',
      'Asynchronous programming with Kotlin Coroutines and Flow',
      'Local database storage with Room and SQLite',
      'Networking with Retrofit, OkHttp, and dependency injection with Hilt'
    ],
    topics: ['Kotlin Essentials', 'Jetpack Compose UI', 'MVVM Architecture', 'Coroutines & Flow', 'Room Database', 'Retrofit & REST APIs', 'Publishing to Google Play']
  },
  {
    title: 'React.js',
    slug: 'reactjs',
    price: 9900,
    category: 'web-development',
    rating: 4.9,
    cover_image: '/uploads/covers/cover_79d736eb-1221-47d7-b902-ed0f04caee25_1790946881516.jpg',
    google_drive_url: 'https://drive.google.com/drive/folders/19yntLn_qNGkLnFFgMwWUKeV9XAUW0qSC?usp=drive_link',
    short_description: 'Master modern React: Hooks, state management, component patterns, performance, and SPA routing.',
    description: 'Comprehensive modern React.js guide. Understand JSX, functional components, all built-in hooks (useState, useEffect, useMemo, useCallback, useRef, useReducer), custom hooks, Context API, state management, and building production SPAs.',
    what_you_learn: [
      'React component fundamentals, JSX, props, and declarative rendering',
      'Mastery of all React Hooks and custom hooks development',
      'State management patterns (Context API, Redux Toolkit, Zustand)',
      'Routing and navigation with React Router v6',
      'Performance optimization with memoization and code splitting',
      'Testing React applications with React Testing Library and Vitest'
    ],
    topics: ['React Components & JSX', 'Hooks Deep Dive', 'Custom Hooks', 'State Management', 'React Router', 'Performance Optimization', 'Full-stack Integration']
  }
];

function seedDatabase(db) {
  if (!db) db = getDb();

  // Ensure ebooks storage directory exists
  const ebookDir = path.isAbsolute(config.EBOOK_STORAGE_PATH)
    ? config.EBOOK_STORAGE_PATH
    : path.join(__dirname, '..', '..', config.EBOOK_STORAGE_PATH);
    
  if (!fs.existsSync(ebookDir)) {
    fs.mkdirSync(ebookDir, { recursive: true });
  }

  // 1. Admin account initialization (never overwrites existing admin)
  const adminQuery = db.prepare('SELECT id FROM admins WHERE email = ? OR username = ?');
  const existingAdmin = adminQuery.get(config.ADMIN_EMAIL, config.ADMIN_USERNAME);
  
  if (!existingAdmin) {
    const hashedPassword = bcrypt.hashSync(config.ADMIN_PASSWORD, 10);
    db.prepare('INSERT INTO admins (id, email, username, password_hash) VALUES (?, ?, ?, ?)').run(
      uuidv4(), config.ADMIN_EMAIL, config.ADMIN_USERNAME || 'admin', hashedPassword
    );
    console.log(`Admin account initialized (${config.ADMIN_EMAIL}).`);
  }

  // 2. Books Catalog Initialization (Idempotent ON CONFLICT / COALESCE to preserve custom admin changes)
  const bookIds = [];
  const insertBook = db.prepare(`
    INSERT INTO books 
    (id, title, slug, price, description, short_description, what_you_learn, topics, category, cover_image, google_drive_url, rating, ebook_filename, is_published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      price = excluded.price,
      description = excluded.description,
      short_description = excluded.short_description,
      what_you_learn = excluded.what_you_learn,
      topics = excluded.topics,
      category = excluded.category,
      rating = excluded.rating,
      ebook_filename = excluded.ebook_filename,
      cover_image = CASE WHEN books.cover_image IS NOT NULL AND books.cover_image != '' THEN books.cover_image ELSE excluded.cover_image END,
      google_drive_url = CASE WHEN books.google_drive_url IS NOT NULL AND books.google_drive_url != '' THEN books.google_drive_url ELSE excluded.google_drive_url END,
      is_published = 1,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const book of booksCatalog) {
    const existing = db.prepare('SELECT id FROM books WHERE slug = ?').get(book.slug);
    const id = existing ? existing.id : uuidv4();
    bookIds.push(id);

    const whatYouLearnJson = JSON.stringify(book.what_you_learn);
    const topicsJson = JSON.stringify(book.topics);
    const filename = `${book.slug}.pdf`;

    insertBook.run(
      id,
      book.title,
      book.slug,
      book.price,
      book.description,
      book.short_description,
      whatYouLearnJson,
      topicsJson,
      book.category,
      book.cover_image || '',
      book.google_drive_url || '',
      book.rating,
      filename
    );

    // Create a rich placeholder PDF sample file if it doesn't exist locally
    const filePath = path.join(ebookDir, filename);
    if (!fs.existsSync(filePath)) {
      const pdfContent = `%PDF-1.4
1 0 obj
<< /Title (${book.title} - CodeLibrary)
   /Author (CodeLibrary)
   /Subject (${book.short_description})
   /Keywords (${book.category}, programming, ebook)
   /Creator (CodeLibrary Publishing) >>
endobj
2 0 obj
<< /Type /Catalog /Pages 3 0 R >>
endobj
3 0 obj
<< /Type /Pages /Kids [4 0 R] /Count 1 >>
endobj
4 0 obj
<< /Type /Page /Parent 3 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>
endobj
5 0 obj
<< /Length 200 >>
stream
BT
/F1 24 Tf
50 720 Td
(${book.title} - CodeLibrary Edition) Tj
/F1 12 Tf
0 -30 Td
(Price: Rs. ${book.price / 100} | Category: ${book.category}) Tj
0 -20 Td
(${book.short_description}) Tj
0 -40 Td
(Thank you for purchasing from CodeLibrary!) Tj
ET
endstream
endobj
6 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 7
0000000000 65535 f 
0000000009 00000 n 
0000000185 00000 n 
0000000234 00000 n 
0000000295 00000 n 
0000000412 00000 n 
0000000665 00000 n 
trailer
<< /Size 7 /Root 2 0 R /Info 1 0 R >>
startxref
740
%%EOF`;
      try {
        fs.writeFileSync(filePath, pdfContent);
      } catch (err) {
        // Silently continue if filesystem write is restricted
      }
    }
  }

  // 3. Complete Programming Bundle (All 19 eBooks for ₹399)
  const bundleSlug = 'complete-programming-bundle';
  const existingBundle = db.prepare('SELECT id FROM bundles WHERE slug = ?').get(bundleSlug);
  
  if (existingBundle) {
    db.prepare(`
      UPDATE bundles SET
        title = 'Complete Programming Bundle',
        description = 'Get instant access to all 19 programming and computer science eBooks. Master web development, data science, AI, computer science, databases, and mobile development in one complete collection.',
        price = 39900,
        books = ?,
        is_active = 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE slug = ?
    `).run(JSON.stringify(bookIds), bundleSlug);
  } else {
    db.prepare(`
      INSERT INTO bundles (id, title, slug, description, price, books, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(
      uuidv4(),
      'Complete Programming Bundle',
      bundleSlug,
      'Get instant access to all 19 programming and computer science eBooks. Master web development, data science, AI, computer science, databases, and mobile development in one complete collection.',
      39900,
      JSON.stringify(bookIds)
    );
  }

  // 4. Customer Reviews
  const reviewsCount = db.prepare('SELECT COUNT(*) as count FROM reviews').get().count;
  if (reviewsCount === 0) {
    const reviews = [
      { name: 'Arjun Mehta', rating: 5, review: 'The Complete Bundle is incredible value. The explanations in the DSA and OS books made complex concepts click immediately!' },
      { name: 'Priya Sharma', rating: 5, review: 'High-quality, practical code examples. The React and Node.js eBooks helped me transition into a full-stack role.' },
      { name: 'Rohan Verma', rating: 5, review: 'Concise, clean, and zero fluff. The Generative AI and Python guides are up-to-date with modern industry standards.' },
      { name: 'Sneha Patel', rating: 4, review: 'Very clear step-by-step progression. Perfect for both university students and working developers.' },
      { name: 'Vikram Singh', rating: 5, review: 'Instant digital delivery right after payment. Beautiful formatting and comprehensive topic coverage.' },
      { name: 'Ananya Roy', rating: 5, review: 'The SQL & DBMS books are the best reference materials I have found. Highly recommended!' }
    ];

    const insertReview = db.prepare('INSERT INTO reviews (id, name, rating, review) VALUES (?, ?, ?, ?)');
    for (const r of reviews) {
      insertReview.run(uuidv4(), r.name, r.rating, r.review);
    }
  }

  // 5. Default Discount Coupons (Idempotent INSERT OR IGNORE, never resets used_count)
  const initialCoupons = [
    {
      code: 'WELCOME10',
      discount_type: 'percentage',
      discount_value: 10,
      min_order_amount: 0,
      max_discount_amount: 10000,
      usage_limit: 1000,
      per_customer_limit: 5,
      is_active: 1
    },
    {
      code: 'CODE50',
      discount_type: 'fixed',
      discount_value: 5000,
      min_order_amount: 9900,
      max_discount_amount: null,
      usage_limit: 500,
      per_customer_limit: 3,
      is_active: 1
    },
    {
      code: 'FIRST20',
      discount_type: 'percentage',
      discount_value: 20,
      min_order_amount: 14900,
      max_discount_amount: 8000,
      usage_limit: 200,
      per_customer_limit: 1,
      is_active: 1
    },
    {
      code: 'SANDEEP78',
      discount_type: 'percentage',
      discount_value: 20,
      min_order_amount: 9900,
      max_discount_amount: 10000,
      usage_limit: 500,
      per_customer_limit: 2,
      is_active: 1
    }
  ];

  const insertCoupon = db.prepare(`
    INSERT OR IGNORE INTO coupons (id, code, discount_type, discount_value, min_order_amount, max_discount_amount, usage_limit, per_customer_limit, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const c of initialCoupons) {
    insertCoupon.run(
      uuidv4(), c.code, c.discount_type, c.discount_value, c.min_order_amount, c.max_discount_amount, c.usage_limit, c.per_customer_limit, c.is_active
    );
  }

  return { success: true, count: booksCatalog.length };
}

async function seed() {
  const db = getDb();
  console.log('Database connected. Starting seed...');
  const res = seedDatabase(db);
  console.log(`Seeding completed successfully (${res.count} books catalog).`);
}

if (require.main === module) {
  seed().catch(console.error);
}

module.exports = { seed, seedDatabase, booksCatalog };
