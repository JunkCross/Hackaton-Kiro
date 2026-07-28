# 🏰 Torre de las Nubes — Duelo AWS

Juego de navegador tipo "stack tower": construye una torre piso a piso mientras tu caballero asciende. Cada 5 pisos aparece una puerta que activa un duelo por turnos contra un "guardián" temático de AWS, resuelto respondiendo preguntas de opción múltiple sobre servicios de AWS (EC2, S3, Lambda, DynamoDB, VPC, IAM, y más).

## 📋 Índice

- [👥 Equipo](#-equipo)
- [🧭 ¿Por qué Kiro?](#-por-qué-kiro)
  - [Desarrollo dirigido por specs](#desarrollo-dirigido-por-specs-spec-driven-development)
  - [El MCP de documentación de AWS](#el-mcp-de-documentación-de-aws)
  - [El uso correcto de specs para features y para bugs](#el-uso-correcto-de-specs-para-features-y-para-bugs)
  - [La importancia del steering](#la-importancia-del-steering)
- [🎯 Objetivos del proyecto](#-objetivos-del-proyecto)
- [📱 Diseño responsive](#-diseño-responsive)
- [☁️ Despliegue en AWS (Amplify + DynamoDB + API Gateway + Lambda + WAF)](#️-despliegue-en-aws-amplify--dynamodb--api-gateway--lambda--waf)
- [🏆 Formulario de descripción del proyecto (para el concurso)](#-formulario-de-descripción-del-proyecto-para-el-concurso)
- [📋 Prerrequisitos](#-prerrequisitos)
- [🚀 Inicio Rápido](#-inicio-rápido)
- [🎮 Ejecución](#-ejecución)
- [📜 Scripts disponibles](#-scripts-disponibles)
- [📁 Estructura del proyecto](#-estructura-del-proyecto)
- [🛠️ Tecnologías](#️-tecnologías)
- [🎥 Evidencia del proyecto](#-evidencia-del-proyecto-capturas-y-video)
- [🌐 Compatibilidad](#-compatibilidad)
- [🤝 Contribuir](#-contribuir)
- [📝 Licencia](#-licencia)

## 👥 Equipo

**Hackathon Kiro - Equipo 81**

Para contribuir al proyecto, lee primero [CONTRIBUTING.md](./CONTRIBUTING.md) que contiene las guías de colaboración y flujo de trabajo con Git.

## 🧭 ¿Por qué Kiro?

Kiro no se usó solo como "un autocompletado más inteligente". Se usó como el proceso de trabajo del equipo: cada cambio no trivial en este repositorio nació como un spec antes de ser código, y Kiro estuvo configurado con acceso directo a documentación oficial de AWS para que el contenido educativo del juego fuera confiable. A continuación explicamos cómo, con evidencia concreta del propio repositorio.

### Desarrollo dirigido por specs (Spec-Driven Development)

Este repositorio tiene **29 specs** bajo `.kiro/specs/`, cada uno en su propia carpeta con `requirements.md`/`bugfix.md`, `design.md` y `tasks.md`. Ninguno de estos cambios se escribió primero como código y se documentó después: el flujo fue siempre requisitos → diseño → tareas.

Para **features nuevas**, el flujo de Kiro exige:
1. `requirements.md` en formato EARS (Easy Approach to Requirements Syntax, con cláusulas `WHEN`/`THE ... SHALL`/`IF ... THEN`), incluyendo un glosario de términos del dominio.
2. `design.md`, que traduce esos requisitos en arquitectura concreta y define **Correctness Properties** explícitas: propiedades que el código debe cumplir para todo input válido, no solo para un ejemplo.
3. `tasks.md`, un plan de implementación incremental donde cada tarea es pequeña, verificable, y (cuando aplica) incluye su propio test de propiedad antes de considerarse completa.

Ejemplos reales de specs de feature en este repo: `dificultad-progresiva-preguntas` (dificultad progresiva de las preguntas según el piso/jefe), `endless-tower-difficulty-cap` (límite de dificultad en la torre infinita), `combat-animation-sfx` (animaciones y efectos de sonido de combate), `modal-pregunta-tarjeta` (rediseño del modal de preguntas), `global-leaderboard` (tabla de puntuaciones global), `combat-sprite-scaling` (escalado de sprites de combate según el ancho del canvas), `landscape-orientation-support` (soporte de orientación horizontal en móviles) y `canvas-relative-physics-balance` (física del juego relativa al tamaño del canvas).

Para **bugfixes**, Kiro usa un flujo distinto y deliberadamente más estricto: la metodología de **"bug condition"**. En vez de arrancar con requisitos de una funcionalidad nueva, un `bugfix.md` documenta tres bloques obligatorios:
- **Current Behavior (Defect)**: qué hace el código hoy, mal, con criterios numerados y verificables.
- **Expected Behavior (Correct)**: qué debería hacer en su lugar.
- **Unchanged Behavior (Regression Prevention)**: comportamiento correcto existente que la corrección NO debe romper.

En la práctica esto significa escribir primero un test que **debe fallar** contra el código sin corregir (demostrando que el bug es real y no una suposición), y solo después escribir el fix, verificado además contra tests de preservación que protegen el comportamiento correcto que ya existía. Ejemplos reales en este repo: `barra-vida-jefe-no-refleja` (la barra de vida del jefe no reflejaba los aciertos porque la vida inicial se calculaba mal, `ceil(cardCount / 2)` en lugar de un punto de vida por carta), `relief-platform-width-collapse` (colapso del ancho de las plataformas de alivio), `relief-platform-canvas-clamp`, `base-platform-canvas-clamp` y `start-screen-mobile-overflow` (bugs de elementos que se salían del canvas o del viewport en pantallas móviles angostas).

Para un proyecto de hackathon construido bajo presión de tiempo, esto se traduce en una ventaja poco común: cada cambio queda documentado con su razón de ser, sus criterios de aceptación exactos, y property-based tests que se ejecutaron antes de dar por completada la tarea — en lugar de la deuda de documentación y de tests que suele acumularse cuando se corre contra el reloj.

### El MCP de documentación de AWS

El archivo `.kiro/settings/mcp.json` de este proyecto configura un servidor MCP (Model Context Protocol) llamado `aws-docs`, que ejecuta `awslabs.aws-documentation-mcp-server` vía `uvx`:

```json
{
  "mcpServers": {
    "aws-docs": {
      "command": "uvx",
      "args": ["awslabs.aws-documentation-mcp-server@latest"],
      "env": { "FASTMCP_LOG_LEVEL": "ERROR" },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Esto le da a Kiro acceso directo a la documentación oficial de AWS al momento de redactar contenido. Se usó específicamente para construir y verificar el banco de preguntas (`QUESTIONS` en `src/data/services.js`), de forma que las preguntas de dificultad media y difícil no se inventaran "de memoria" sino que estuvieran ancladas en documentación real de cada servicio — reduciendo el riesgo de información sutilmente incorrecta o desactualizada sobre AWS, algo que le importa mucho a una herramienta de estudio.

El spec `dificultad-progresiva-preguntas` documenta explícitamente esta exigencia: las preguntas de nivel medio y difícil deben redactarse "con un enunciado orientado a escenario... conforme al estilo del Examen Cloud Practitioner (CLF-C02)", y el banco de preguntas debe cubrir, a lo largo de todos los servicios, los cuatro dominios reales del examen AWS Certified Cloud Practitioner (CLF-C02): **Conceptos de la Nube** (~24%), **Seguridad y Cumplimiento** (~30%), **Tecnología y Servicios en la Nube** (~34%) y **Facturación, Precios y Soporte** (~12%).

### El uso correcto de specs para features y para bugs

Usar el flujo equivocado para cada situación es fácil y costoso: aplicar un flujo de feature completo (con Correctness Properties de diseño) a un bug de una línea es sobre-ingeniería; y "arreglar" una mecánica nueva sin especificar primero su diseño y sus casos límite es sub-especificación que termina en re-trabajo.

Kiro separa ambos casos deliberadamente:
- El flujo de **feature** (requirements-first) invierte el esfuerzo en decidir el comportamiento y sus criterios de aceptación *antes* de que exista código, lo que evita construir mecánicas nuevas sobre supuestos no verificados.
- El flujo de **bugfix** invierte el esfuerzo en **demostrar** que el bug existe (con un test que falla en el código actual) antes de tocar nada, y luego en demostrar que la corrección no rompe nada más (tests de preservación). Esto evita tanto los fixes superficiales que no atacan la causa real, como las correcciones que arreglan un síntoma y rompen otro.

En este repositorio, esa distinción se ve en la mezcla real de specs: la mayoría son features (`sonido-ataque-guerrero`, `boss-fight-sprite-animations`, `tower-progression-scaling`, `background-music-controls`, entre otros) y un subconjunto está marcado explícitamente como bugfix (`barra-vida-jefe-no-refleja`, `relief-platform-width-collapse`), cada uno con su `.config.kiro` indicando `"specType": "bugfix"`.

### La importancia del steering

Los archivos en `.kiro/steering/` (`product.md`, `structure.md`, `tech.md`) funcionan como la memoria persistente del proyecto: Kiro los lee al empezar cada sesión de trabajo, así que decisiones arquitectónicas importantes no hay que re-explicarlas — ni arriesgarse a violarlas por accidente — en cada conversación nueva.

El ejemplo más concreto de esto es el propio historial del proyecto: `Torre de las Nubes` comenzó como un único archivo HTML monolítico (`torre-de-las-nubes.html`, con CSS y JavaScript inline en un IIFE). El spec `modular-architecture-migration` documentó la migración completa a una arquitectura modular con módulos ES y Vite bajo `src/`. Una vez migrado, `torre-de-las-nubes.html` quedó **congelado**: ningún spec ni tarea posterior lo modifica, y `structure.md` y `tech.md` lo dejan explícito para que ninguna sesión futura de Kiro (ni ningún miembro del equipo) intente "arreglar" o duplicar lógica ahí por error.

De hecho, `structure.md` y `tech.md` fueron actualizados como parte de este mismo esfuerzo de documentación, para reflejar con precisión la arquitectura modular ya completada (las subcarpetas reales de `src/`, las convenciones de testing con Vitest + fast-check, etc.). Es un buen ejemplo de que el steering no es un artefacto que se escribe una vez y se olvida, sino un documento vivo que se mantiene al día junto con el código.

## 🎯 Objetivos del proyecto

Queremos ayudar a que la gente repase sus conocimientos de AWS de una forma entretenida y hasta un poco adictiva, construyendo confianza real de cara a un examen del nivel del AWS Certified Cloud Practitioner. La idea no es solo "poner preguntas en una pantalla": es que subir la torre y enfrentar a cada guardián se sienta como un reto que quieres superar, y que al hacerlo salgas con la sensación de que sí entendiste el servicio de AWS que acabas de repasar, no solo de que memorizaste una respuesta.

## 📱 Diseño responsive

Torre de las Nubes se juega tanto en escritorio como en dispositivos móviles, y la adaptación a pantallas pequeñas no fue un ajuste superficial de CSS: se abordó como un plan de trabajo propio, dividido en specs incrementales bajo `.kiro/specs/`, cada una con su propio diseño y sus propios tests. El plan cubrió cuatro frentes:

- **Escalado visual del combate** (`combat-sprite-scaling`): el guerrero y cada guardián de AWS escalan su tamaño de dibujo en función del ancho real del canvas, en vez de usar un tamaño fijo en píxeles que se saliera de pantalla en móviles angostos.
- **Plataformas y bloques que respetan el ancho del canvas** (`relief-platform-canvas-clamp`, `base-platform-canvas-clamp`): tanto la plataforma base de la torre como las plataformas de alivio (premio) se acotan siempre al ancho visible del canvas, corrigiendo un bug en el que podían generarse más anchas que la pantalla del jugador.
- **Layout de interfaz en pantallas pequeñas** (`combat-cards-mobile-layout`, `hud-responsive-layout`, `landscape-orientation-support`, `start-screen-mobile-overflow`): las cartas de combate, el HUD superior y la pantalla de bienvenida reorganizan o reducen sus elementos en el breakpoint móvil (`≤520px`), y el juego soporta jugarse en orientación horizontal (landscape) en teléfonos.
- **Física del juego relativa al tamaño de pantalla y feedback táctil** (`canvas-relative-physics-balance`, `touch-feedback-polish`): la velocidad y el margen de tolerancia al soltar un bloque se calculan como proporción del ancho del canvas (no como píxeles fijos), para que la dificultad se sienta igual en cualquier tamaño de pantalla; y los elementos interactivos (cartas, botones, opciones de respuesta) tienen retroalimentación visual inmediata al tocarlos en pantallas táctiles.

Cada una de estas specs sigue el mismo rigor documentado en la sección anterior: diseño con Correctness Properties, y verificación con property-based tests (Vitest + fast-check) antes de darse por completada.

## ☁️ Despliegue en AWS (Amplify + DynamoDB + API Gateway + Lambda + WAF)

El leaderboard global de Torre de las Nubes no vive solo en el navegador del jugador: está respaldado por infraestructura real de AWS, definida como código (Infrastructure as Code) en la carpeta `infrastructure/` mediante plantillas CloudFormation (`.yml`).

### Arquitectura

```
Jugador (navegador)
      ↓ fetch()
AWS WAF (Web ACL)  →  protección contra DDoS y tráfico malicioso
      ↓
API Gateway (REST)  →  recurso /scores, métodos GET/POST/DELETE/OPTIONS con CORS
      ↓
AWS Lambda (Node.js, arm64)  →  torre-nubes-scores-api (lambda/handler.js)
      ↓
Amazon DynamoDB  →  tabla torre-nubes-scores + índice secundario global (GSI) por puntaje

Frontend (Vite build)  →  AWS Amplify Hosting, con integración continua automática desde GitHub
```

### Componentes desplegados

- **Amazon DynamoDB**: tabla `torre-nubes-scores` en modo de facturación *on-demand* (sin costo fijo), con un índice secundario global (`gameId-score-index`) que permite consultar el top de puntuaciones ordenado de mayor a menor sin necesidad de un `scan` completo de la tabla.
- **AWS Lambda**: función `torre-nubes-scores-api` (Node.js, arquitectura `arm64` para menor costo) que implementa los endpoints `GET /scores`, `POST /scores` y `DELETE /scores`. El código vive en `lambda/handler.js`, con sus propios tests en `lambda/__tests__/`.
- **Amazon API Gateway**: API REST regional que expone la Lambda al público, con CORS habilitado para que el frontend en Amplify pueda consultarla desde el navegador.
- **AWS WAF (Web Application Firewall)**: Web ACL asociada al API Gateway para mitigar ataques de denegación de servicio (DDoS) y patrones de tráfico maliciosos antes de que lleguen a la Lambda.
- **AWS Amplify Hosting**: sirve el build de producción de Vite (`dist/`) con CDN global, con **integración continua automática con GitHub**: cada `push` a la rama principal dispara un nuevo build y despliegue sin intervención manual, siguiendo la configuración de `amplify.yml`.

### Infraestructura como código

La carpeta [`/infrastructure`](./infrastructure) contiene las plantillas CloudFormation que definen todos los recursos de backend:

- `cloudformation.yml` — plantilla principal: tabla DynamoDB (con su GSI), rol IAM de la Lambda, la función Lambda, y el API Gateway REST con sus métodos y el stage `prod`.
- `cloudformation-phase1.yml` / `cloudformation-import.yml` — variantes usadas durante el despliegue incremental (por ejemplo, para importar una tabla DynamoDB ya existente sin recrearla).
- `deploy.ps1` — script de despliegue en PowerShell que empaqueta el código de la Lambda, lo sube a S3, y crea o actualiza el stack de CloudFormation.

> **Nota sobre el rol IAM de la Lambda:** aunque `cloudformation.yml` define declarativamente el rol `LambdaExecutionRole` con permisos de `dynamodb:PutItem`/`Query`/`DeleteItem`/`BatchWriteItem` acotados al ARN de la tabla y su índice, durante el desarrollo inicial ese rol se creó manualmente desde la consola de IAM para poder iterar rápido en los permisos exactos que la Lambda necesitaba antes de consolidarlos en la plantilla.

### Variable de entorno del frontend

El frontend decide en tiempo de build si usa el leaderboard remoto (DynamoDB) o `localStorage` como respaldo local, según la variable de entorno `VITE_SCORES_API_URL`:

- Si está definida (configurada en Amplify Console), el juego usa `DynamoDBScoreStore` y el leaderboard es global y compartido entre todos los jugadores.
- Si no está definida (por ejemplo, en desarrollo local con `npm run dev`), el juego usa `LocalStorageScoreStore` automáticamente, sin necesidad de tener la infraestructura AWS desplegada para poder trabajar en el resto del código.

Esta selección automática está documentada como spec en [`dynamodb-leaderboard-amplify-deploy`](./.kiro/specs/dynamodb-leaderboard-amplify-deploy), con Correctness Properties formales sobre el comportamiento de `DynamoDBScoreStore` (manejo de errores de red, orden del leaderboard, CORS, y el pipeline de CI/CD de Amplify).

Link del despliegue: https://main.dw7ryx3dr1rvo.amplifyapp.com/

## 🏆 Formulario de descripción del proyecto (para el concurso)

### ¿En cuál reto o vertical enfocaron su proyecto?

- [x] Videojuegos
- [ ] Aplicaciones web
- [ ] Agentes especializados
- [ ] Productividad para desarrolladores

### ¿Qué problema soluciona su proyecto?

Estudiar para una certificación como el AWS Certified Cloud Practitioner suele reducirse a leer documentación densa o hacer baterías de preguntas sueltas, sin ningún elemento que sostenga la motivación a lo largo del repaso. Torre de las Nubes convierte ese repaso en un juego: construir la torre y ganar duelos contra guardianes exige responder correctamente preguntas de opción múltiple sobre servicios reales de AWS, con una dificultad que progresa a medida que el jugador avanza (los pisos más altos y los jefes posteriores presentan preguntas de nivel medio y difícil, organizadas según los cuatro dominios reales del temario CLF-C02: Conceptos de la Nube, Seguridad y Cumplimiento, Tecnología y Servicios en la Nube, y Facturación/Precios/Soporte). El resultado es una forma de repaso activo, con retroalimentación inmediata (aciertos dañan al jefe, errores dañan al jugador) que mantiene el interés del estudiante en vez de depender solo de su fuerza de voluntad.

### ¿Por qué consideras(n) que su proyecto debería ser el ganador? ¿Cuáles son sus mayores fortalezas?

- **Rigor de desarrollo poco común para el tamaño del equipo**: 29 specs documentados, cada uno con requisitos formales (EARS), diseño con Correctness Properties explícitas, y tareas verificadas con tests unitarios y property-based tests (Vitest + fast-check) antes de darse por completadas. Los bugs se corrigieron con la metodología de "bug condition" (test que falla antes del fix, tests de preservación después), no a base de parches ad-hoc, incluyendo un plan completo de adaptación responsive a dispositivos móviles y una infraestructura de backend real en AWS (DynamoDB, Lambda, API Gateway, Amplify, WAF) definida como código.
- **Contenido educativo verificado, no inventado**: el banco de preguntas se redactó y verificó usando el MCP de documentación oficial de AWS, alineando las preguntas de dificultad media/difícil con el estilo real del examen CLF-C02 y sus cuatro dominios de contenido.
- **Un bucle de juego genuinamente atractivo como mecanismo de estudio**: la combinación de construir la torre (mecánica de habilidad, tipo stack tower) con duelos de preguntas contra jefes temáticos de AWS da al repaso una tensión y un ritmo que una lista de flashcards no tiene.
- **Atención a compatibilidad y experiencia del jugador ya en marcha**: soporte explícito para las últimas versiones de Chrome, Firefox, Edge y Safari (escritorio y móvil), con degradación elegante si Web Audio API no está disponible.

### Comentarios adicionales

Este proyecto nació de la idea de que repasar para una certificación de AWS no tiene por qué sentirse como una obligación aburrida. Nos importa que quien juegue Torre de las Nubes termine cada sesión con un poco más de confianza real sobre los servicios que acaba de repasar, y que llegar a la cima de la torre se sienta como una recompensa genuina, no solo como una partida más. Gracias por revisar nuestro proyecto.

## 📋 Prerrequisitos

- **Node.js** versión 18.x o superior
- Gestor de paquetes: `npm` (incluido con Node.js) o `yarn`/`pnpm`

## 🚀 Inicio Rápido

### 1. Clonar el repositorio

```bash
git clone git@github.com:DeanMorales/Hackaton-Kiro_manu.git
cd Hackaton-Kiro_manu
```

### 2. Instalar dependencias

```bash
npm install
```

## 🎮 Ejecución

### Modo desarrollo

Inicia el servidor de desarrollo con recarga automática:

```bash
npm run dev
```

El juego estará disponible en `http://localhost:5173/` (o el puerto que indique la terminal).

### Build de producción

Genera los archivos estáticos optimizados para producción:

```bash
npm run build
```

Los archivos se generan en el directorio `dist/`.

### Previsualizar el build

Sirve el build de producción localmente para probarlo:

```bash
npm run preview
```

### Método anterior (ya no soportado)

⚠️ **Importante**: El método anterior de abrir `torre-de-las-nubes.html` directamente con doble clic **ya no está soportado** tras la migración a módulos ES y Vite.

Las dos rutas válidas de ejecución son:
1. **Modo desarrollo**: `npm run dev` (recomendado para desarrollo)
2. **Build + servidor estático**: `npm run build` + servir el directorio `dist/` con cualquier servidor de archivos estáticos

## 📜 Scripts disponibles

- `npm run dev` - Inicia el servidor de desarrollo
- `npm run build` - Genera el build de producción
- `npm run preview` - Previsualiza el build de producción
- `npm test` - Ejecuta los tests (Vitest)
- `npm run check-circular` - Verifica que no haya imports circulares (requiere `madge` instalado)

## 📁 Estructura del proyecto

```
Hackaton-Kiro/
├── README.md
├── CONTRIBUTING.md
├── index.html                 ← punto de entrada HTML (Vite)
├── package.json                ← dependencias y scripts (Vite, Vitest, fast-check)
├── torre-de-las-nubes.html    ← monolito histórico, CONGELADO (no se modifica)
├── src/
│   ├── data/          # AWS_SERVICES, banco de preguntas (QUESTIONS), bossRoster, playerName, scoreManager/scoreStore
│   ├── audio/         # sfx.js, music.js, combatSfx.js, milestoneSfx.js (Web Audio API + archivos de audio)
│   ├── engine/        # tower.js — estado y física de la torre (pisos, bloque en movimiento, velocidad, plataformas)
│   ├── combat/        # fight.js — lógica del duelo contra el guardián (cartas, pips, dificultad)
│   ├── render/        # draw.js, bossFightRender.js, spriteEngine.js — dibujo en canvas
│   ├── ui/            # screens.js, leaderboard.js, celebration.js, modalState.js — overlays DOM y HUD
│   ├── integration/   # tests de integración entre módulos
│   └── main.js        # bucle principal, wiring de todos los módulos
├── public/            # sprites/, audio/ — assets estáticos servidos por Vite
├── infrastructure/    # plantillas CloudFormation (.yml) e IaC del backend AWS (DynamoDB, Lambda, API Gateway)
├── lambda/            # código de la función Lambda del leaderboard (handler.js) y sus tests
└── .kiro/
    ├── steering/      # contexto persistente (product.md, structure.md, tech.md)
    └── specs/         # specs de features/bugfix (requirements.md o bugfix.md, design.md, tasks.md)
```

Cada módulo de `src/` sigue el patrón "lógica pura, sin efectos secundarios de UI": `engine/`, `combat/` y `data/` no tocan el DOM ni el audio directamente; esas responsabilidades viven en `ui/`, `render/`, `audio/` y se orquestan desde `main.js`.

## 🛠️ Tecnologías

- **JavaScript vanilla (ES6+) en módulos ES**: sin frameworks UI ni TypeScript.
- **Vite**: build tool y servidor de desarrollo.
- **Vitest + fast-check**: framework de testing y de property-based testing. Cada módulo relevante de lógica de motor/combate tiene su archivo `*.test.js` con tests unitarios y property-based tests (mínimo 100 ejecuciones por propiedad), y cada `design.md` de un spec define Correctness Properties explícitas que se verifican con estos tests antes de considerar una tarea completa.
- **Canvas 2D**: renderizado del mundo del juego (torre, bloques, caballero) y de la arena de combate.
- **Web Audio API**: síntesis de efectos de sonido en tiempo real, combinada con archivos de audio pregrabados para combate y música.
- **AWS (DynamoDB, Lambda, API Gateway, Amplify Hosting, WAF)**: backend del leaderboard global, desplegado como infraestructura como código con CloudFormation (ver sección [Despliegue en AWS](#️-despliegue-en-aws-amplify--dynamodb--api-gateway--lambda--waf)).

## 🎥 Evidencia del proyecto (capturas y video)

### Capturas de pantalla

<img width="367" height="640" alt="Screenshot_20260727_192120_Brave" src="https://github.com/user-attachments/assets/2b4517e5-51ca-43fa-9f31-12aee61b490d" />

<img width="370" height="640" alt="Screenshot_20260727_192146_Brave" src="https://github.com/user-attachments/assets/37706958-7792-4e02-a6e2-68ba8ec059bc" />

<img width="365" height="640" alt="Screenshot_20260727_192223_Brave" src="https://github.com/user-attachments/assets/78c0a91e-645d-4a28-b5c5-8606b789d73e" />

<img width="355" height="768" alt="Screenshot_20260727_192025_Chrome" src="https://github.com/user-attachments/assets/3ad8b146-16bf-4b47-9130-ae552d707acb" />

<img width="921" height="432" alt="image" src="https://github.com/user-attachments/assets/4a0b22e3-330c-4900-b182-f2e106dfebf8" />

## 🌐 Compatibilidad

El juego funciona en las últimas versiones estables de:
- Chrome (escritorio y Android)
- Firefox
- Edge
- Safari (escritorio e iOS)

Requiere soporte para Canvas 2D y ES modules nativos. Web Audio API es opcional (el juego funciona sin sonido si no está disponible).

## 🤝 Contribuir

Lee nuestra [Guía de Contribución](./CONTRIBUTING.md) para conocer:
- Flujo de trabajo con Git (branching strategy)
- Convención de commits
- Proceso de Pull Requests
- Code review
- Mejores prácticas del equipo

## 📝 Licencia

Este proyecto fue desarrollado para el Hackathon Kiro.

---

**¿Preguntas?** Contacta al equipo o abre un issue en GitHub.
