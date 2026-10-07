const { getDb } = require('./schema');
const config = require('../utils/config');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

async function seed() {
  const db = getDb();
  console.log('Database connected. Starting seed...');

  // Ensure ebooks storage directory exists
  const ebookDir = path.isAbsolute(config.EBOOK_STORAGE_PATH)
    ? config.EBOOK_STORAGE_PATH
    : path.join(__dirname, '..', '..', config.EBOOK_STORAGE_PATH);
    
  if (!fs.existsSync(ebookDir)) {
    fs.mkdirSync(ebookDir, { recursive: true });
  }

  // Create Admin
  const adminQuery = db.prepare('SELECT id FROM admins WHERE email = ? OR username = ?');
  const existingAdmin = adminQuery.get(config.ADMIN_EMAIL, config.ADMIN_USERNAME);
  
  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(config.ADMIN_PASSWORD, 10);
    db.prepare('INSERT INTO admins (id, email, username, password_hash) VALUES (?, ?, ?, ?)').run(
      uuidv4(), config.ADMIN_EMAIL, config.ADMIN_USERNAME || 'admin', hashedPassword
    );
    console.log(`Admin account created (${config.ADMIN_EMAIL}).`);
  }

  // Exactly 19 eBooks specification
  const booksCatalog = [
    {
      title: 'HTML & CSS',
      slug: 'html-css',
      price: 9900,
      category: 'web-development',
      rating: 4.8,
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

  const bookIds = [];
  const insertBook = db.prepare(`
    INSERT INTO books 
    (id, title, slug, price, description, short_description, what_you_learn, topics, category, rating, ebook_filename, is_published)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
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
      book.rating,
      filename
    );

    // Create a rich placeholder PDF sample file if it doesn't exist
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
      fs.writeFileSync(filePath, pdfContent);
    }
  }
  console.log(`Seeded ${booksCatalog.length} books with PDF files.`);

  // Complete Programming Bundle (All 19 eBooks for ₹399)
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
  console.log('Complete Programming Bundle created/updated (19 books, ₹399).');

  // Reviews
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
    console.log('Reviews seeded.');
  }

  // Seed Default Discount Coupons
  const initialCoupons = [
    {
      code: 'WELCOME10',
      discount_type: 'percentage',
      discount_value: 10,
      min_order_amount: 0,
      max_discount_amount: 10000, // ₹100 max discount
      usage_limit: 1000,
      per_customer_limit: 5,
      is_active: 1
    },
    {
      code: 'CODE50',
      discount_type: 'fixed',
      discount_value: 5000, // ₹50 off
      min_order_amount: 9900, // min ₹99
      max_discount_amount: null,
      usage_limit: 500,
      per_customer_limit: 3,
      is_active: 1
    },
    {
      code: 'FIRST20',
      discount_type: 'percentage',
      discount_value: 20,
      min_order_amount: 14900, // min ₹149
      max_discount_amount: 8000, // ₹80 max discount
      usage_limit: 200,
      per_customer_limit: 1,
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
  console.log('Default coupons seeded (WELCOME10, CODE50, FIRST20).');

  console.log('Seeding complete successfully.');
}

if (require.main === module) {
  seed().catch(console.error);
}

module.exports = { seed };
