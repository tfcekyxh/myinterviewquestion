/**
 * 演示题库：60 道 Java 面试题（速记风格：题干一行，答案 2-3 行）。
 *
 * 这份数据有三个用途，必须保持一致：
 *  1. gen-demo-pdf.mjs 用它渲染「演示题库 PDF」（字号台阶匹配 parse.ts 的切题规则）
 *  2. seed-demo.ts 用它在服务端预置题库（让片段 3-5 不依赖片段 2 也能单独跑）
 *  3. 两条路径产出同一批题 → 片段 2 重新导入 PDF 后 seq 不变，进度/复习范围依然成立
 *
 * 排版约束（写新题时别破）：
 *  - 题干必须一行放下（PDF 里约 74 个汉字宽度），所以 ≤ 30 字
 *  - 答案每行 ≤ 40 字且以「。」结尾 —— 「。」让 parse.ts 的 joinAnswer 认定为硬换行，
 *    不会把两行粘成一行；不超宽则不会被 Chromium 软折行
 */

export interface DemoQA {
  question: string
  /** 答案按行存，每行一个段落 */
  answer: string
}

export const DEMO_QUESTIONS: DemoQA[] = [
  {
    question: 'HashMap 底层结构是什么？',
    answer:
      '数组加链表加红黑树。\n链表长度超过 8 且数组长度超过 64 时转红黑树，退化为 6 时转回链表。',
  },
  {
    question: 'HashMap 为什么线程不安全？',
    answer:
      '多线程同时扩容会丢数据。\nJDK 7 的头插法迁移还可能造成链表死循环。\n并发场景请用 ConcurrentHashMap。',
  },
  {
    question: 'ConcurrentHashMap 如何保证并发？',
    answer:
      'JDK 7 用分段锁，段之间互不干扰。\nJDK 8 改为 CAS 加 synchronized 锁链表头节点。\n锁粒度更细，读操作基本无锁。',
  },
  {
    question: 'synchronized 和 ReentrantLock 区别？',
    answer:
      'synchronized 是 JVM 关键字，自动加解锁。\nReentrantLock 是 API，可中断、可公平、可限时尝试加锁。',
  },
  {
    question: 'volatile 能保证原子性吗？',
    answer:
      '不能，它只保证可见性与禁止指令重排。\n计数等复合操作仍要锁或原子类。',
  },
  {
    question: 'JVM 内存结构包含哪些区域？',
    answer:
      '堆、方法区、虚拟机栈、本地方法栈、程序计数器。\n堆是垃圾回收主战场，栈随线程创建而生、销毁而灭。',
  },
  {
    question: '对象什么时候进入老年代？',
    answer:
      '大对象直接进入老年代。\n长期存活对象年龄达到 15 岁晋升。\n动态年龄判定达标时同批对象一起晋升。',
  },
  {
    question: 'GC Root 有哪些？',
    answer:
      '虚拟机栈中的引用、方法区静态属性、常量池引用。\n本地方法栈里 JNI 引用的对象也是根。',
  },
  {
    question: 'CMS 和 G1 的区别？',
    answer:
      'CMS 追求低延迟，但标记清除会产生内存碎片。\nG1 面向服务端，按 Region 回收，停顿时间可预测。',
  },
  {
    question: '类加载过程分几步？',
    answer:
      '加载、验证、准备、解析、初始化五步。\n双亲委派发生在加载阶段的类加载器协作上。',
  },
  {
    question: '双亲委派模型是什么？',
    answer:
      '加载器先委派父加载器尝试，父不行才自己加载。\n好处是核心类不会被自定义实现篡改。',
  },
  {
    question: '如何打破双亲委派？',
    answer:
      '自定义加载器重写 loadClass 即可绕过委派。\nJDBC 等服务接口用的是线程上下文类加载器这条路。',
  },
  {
    question: '什么是内存泄漏？',
    answer:
      '对象已无用处却仍被引用，GC 无法回收。\n常见于静态集合、未注销的监听器、忘记关闭的连接。',
  },
  {
    question: '线程池核心参数有哪些？',
    answer:
      '核心线程数、最大线程数、空闲存活时间、工作队列。\n再加拒绝策略与线程工厂，共六件套。',
  },
  {
    question: '线程池拒绝策略有几种？',
    answer:
      '中止、直接丢弃、丢弃最老、调用者执行四种。\n生产环境常用调用者执行来兜底降压。',
  },
  {
    question: 'Executors 有什么问题？',
    answer:
      '默认使用无界队列，请求堆积会拖垮内存。\n应手动指定参数并改用有界队列。',
  },
  {
    question: 'ThreadLocal 原理与坑？',
    answer:
      '每个线程持有一份变量副本，天然隔离。\n用完后必须 remove，否则线程池复用会内存泄漏。',
  },
  {
    question: 'AQS 是什么？',
    answer:
      '抽象队列同步器，用 volatile 状态量加 CLH 队列。\nReentrantLock、Semaphore、CountDownLatch 都基于它。',
  },
  {
    question: 'synchronized 锁升级过程？',
    answer:
      '无锁、偏向锁、轻量级锁、重量级锁逐级晋升。\n只有竞争出现才升级，各状态撤销都有开销。\nJDK 15 起偏向锁已默认禁用，别照背旧八股。',
  },
  {
    question: 'CAS 是什么？有什么问题？',
    answer:
      '比较并交换，靠一条 CPU 原子指令实现的乐观锁。\n存在 ABA 问题，可用版本号方案解决。\n自旋忙等会消耗 CPU，适合短临界区。',
  },
  {
    question: '死锁的四个条件？',
    answer:
      '互斥、请求保持、不可剥夺、循环等待。\n破坏任一条件即可避免，比如全局按序加锁。\n排查用 jstack 找 blocked 线程与锁持有关系。',
  },
  {
    question: 'Java 内存模型是什么？',
    answer:
      '主内存与工作内存之间的抽象约定。\n通过 happens-before 规则保证可见性与有序性。',
  },
  {
    question: '什么是 happens-before？',
    answer:
      '操作之间的偏序关系，前一个操作对后一个可见。\n常见规则：程序次序、volatile 写读、锁释放获取。',
  },
  {
    question: '重载与重写的区别？',
    answer:
      '重载看参数列表，编译期绑定。\n重写看方法签名，运行期动态分派，返回类型要兼容。',
  },
  {
    question: 'String 为什么不可变？',
    answer:
      '字符数组是 final 的，且不提供任何修改方法。\n好处是哈希可缓存、天生线程安全，适合做 Map 的键。',
  },
  {
    question: 'String、StringBuilder、StringBuffer？',
    answer:
      'String 不可变，拼接会产生新对象。\nStringBuilder 非线程安全但速度最快。\nStringBuffer 方法都加了锁，线程安全。',
  },
  {
    question: 'equals 与 hashCode 约定？',
    answer:
      '相等则哈希码必须相同，哈希相同不一定相等。\n重写 equals 必须同时重写 hashCode，否则哈希容器失效。',
  },
  {
    question: '深拷贝与浅拷贝区别？',
    answer:
      '浅拷贝只复制引用，新旧对象共享子对象。\n深拷贝递归复制所有层级，彼此完全独立。',
  },
  {
    question: '泛型擦除是什么？',
    answer:
      '编译期泛型信息被擦除为上限类型。\n运行时可借助反射读取签名上的残留痕迹。',
  },
  {
    question: '反射破坏单例怎么办？',
    answer:
      '反射可以调用私有构造器拿到第二个实例。\n枚举单例由 JVM 保证，反射也无法破坏。',
  },
  {
    question: '泛型上下界 PECS 原则？',
    answer:
      '生产者用 extends，消费者用 super。\n在集合读写之间取得灵活平衡。',
  },
  {
    question: 'ArrayList 扩容机制？',
    answer:
      '默认容量 10，满了按 1.5 倍扩容。\n底层用 Arrays.copyOf 拷贝，频繁扩容有开销。',
  },
  {
    question: 'ArrayList 与 LinkedList 区别？',
    answer:
      'ArrayList 基于数组，随机访问快。\nLinkedList 基于链表，首尾插删快但缓存不友好。',
  },
  {
    question: 'fail-fast 是什么？',
    answer:
      '迭代期间结构被修改会抛并发修改异常。\n可用迭代器自身删除，或换 CopyOnWriteArrayList。',
  },
  {
    question: 'HashMap 初始容量怎么设？',
    answer:
      '按预期元素量除以负载因子 0.75 估算。\n避免边用边扩容，初始值会取到 2 的幂。',
  },
  {
    question: '红黑树有什么特性？',
    answer:
      '根与叶子必黑、红结点的子结点必黑、黑高相等。\n插入删除最多三次旋转即可恢复平衡。',
  },
  {
    question: 'BIO、NIO、AIO 区别？',
    answer:
      'BIO 一个连接一个线程，阻塞等待。\nNIO 多路复用，单线程管理多条通道。\nAIO 异步回调，操作完成才通知。',
  },
  {
    question: 'Netty 为什么快？',
    answer:
      '零拷贝、内存池化、无锁化设计与 Reactor 模型。\n还修复了 NIO 著名的 epoll 空轮询问题。',
  },
  {
    question: 'select、poll、epoll 区别？',
    answer:
      'select 有连接数上限且要反复拷贝描述符。\npoll 去掉了上限，但仍要遍历轮询。\nepoll 事件驱动，只返回就绪的那些。',
  },
  {
    question: 'TCP 三次握手过程？',
    answer:
      '客户端发 SYN，服务端回 SYN 加 ACK，客户端再回 ACK。\n第三次握手即可携带数据，省一次往返。',
  },
  {
    question: '为什么握手是三次不是两次？',
    answer:
      '三次才能让双方都确认对方收发正常。\n同时完成初始序列号的同步，防止历史重复连接。',
  },
  {
    question: 'TCP 四次挥手为什么？',
    answer:
      '关闭是双向的，要各自发一次 FIN。\n服务端收到 FIN 后可能还有数据要发，故 ACK 与 FIN 分两步。',
  },
  {
    question: 'TIME_WAIT 是什么？',
    answer:
      '主动关闭方等待两个最长报文寿命的时间。\n确保最后的 ACK 被收到，并让旧报文自然消散。',
  },
  {
    question: 'TCP 拥塞控制有哪些？',
    answer:
      '慢启动、拥塞避免、快重传、快恢复四步。\n配合滑动窗口与接收缓冲区共同调速。',
  },
  {
    question: 'HTTP 1.1 与 2.0 区别？',
    answer:
      '2.0 改为二进制分帧，支持多路复用。\n还有头部压缩与服务端推送，解决了队头阻塞。',
  },
  {
    question: 'HTTPS 握手做了什么？',
    answer:
      '验证证书、协商密码套件、ECDHE 交换密钥。\n之后全程用对称加密通信。',
  },
  {
    question: 'Cookie 与 Session 区别？',
    answer:
      'Cookie 存在客户端，体积受限且有泄露风险。\nSession 存服务端，客户端只带一个会话 ID。',
  },
  {
    question: 'GET 与 POST 的区别？',
    answer:
      'GET 参数在地址栏，可缓存且幂等。\nPOST 参数在请求体，适合写操作与敏感数据。',
  },
  {
    question: '什么是 XSS？如何防？',
    answer:
      '攻击者注入脚本在他人浏览器里执行。\n防范靠输出转义、内容安全策略与 HttpOnly Cookie。',
  },
  {
    question: 'CSRF 怎么防？',
    answer:
      '核心是确认请求来自真实用户而非伪造站点。\n手段有校验来源、一次性 Token 与 SameSite Cookie。',
  },
  {
    question: 'SQL 注入如何防？',
    answer:
      '一律用预编译占位符，绝不拼接 SQL。\n再配合输入校验与数据库最小权限。',
  },
  {
    question: '聚簇索引与非聚簇索引？',
    answer:
      'InnoDB 聚簇索引叶子结点就是数据行。\nMyISAM 非聚簇索引叶子存的是地址，需二次查找。',
  },
  {
    question: '什么是最左前缀匹配？',
    answer:
      '联合索引从最左列开始，遇到范围查询即停。\n索引列顺序设计比索引数量更关键。',
  },
  {
    question: '事务的 ACID 与隔离级别？',
    answer:
      '原子性、一致性、隔离性、持久性四大特性。\n隔离级别有读未提交、读已提交、可重复读、串行化。',
  },
  {
    question: 'MVCC 如何实现？',
    answer:
      '三件套：隐式版本列、undo 版本链、ReadView。\n快照读靠可见性判断，读写互不阻塞。\n当前读仍走锁；可重复读下首次 ReadView 定快照。',
  },
  {
    question: '什么是间隙锁？',
    answer:
      '锁住记录之间的开区间，防止插入造成幻读。\n与 next-key lock 配合，在可重复读级别生效。\n代价是锁范围扩大易死锁，事务宜短。',
  },
  {
    question: '慢 SQL 怎么排查？',
    answer:
      '先开慢日志定位，再 explain 看执行类型。\n重点消灭全表扫描与文件排序，索引要建在刀刃上。',
  },
  {
    question: '覆盖索引是什么？',
    answer:
      '查询列全部在索引上，无需回表查数据行。\n能显著减少随机 IO，是性价比最高的优化。',
  },
  {
    question: 'Redis 为什么快？',
    answer:
      '纯内存操作，单线程避免上下文切换。\n加上 IO 多路复用与高效的数据结构。',
  },
  {
    question: 'Redis 持久化有几种？',
    answer:
      'RDB 定时快照与 AOF 命令日志两种。\n混合模式兼顾速度与安全，按业务容忍度选择。',
  },
]

/** 演示 PDF 的文件名（片段 2 里会显示在文件卡片上） */
export const DEMO_PDF_NAME = 'Java 面试题速记 60 题（演示）.pdf'
