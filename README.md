# Transactions Analyzer
A full-stack financial document analyzer that extracts transaction data from images and PDFs using OCR technology.
## Features
- 📸 **Image Processing**: Extract text from PNG, JPG, and JPEG images using Tesseract OCR
- 📄 **PDF Parsing**: Parse PDF documents to extract financial transaction data
- 🖥️ **React Frontend**: Modern UI built with React and Vite
- 🔌 **REST API**: Express.js backend with CORS support
- ☁️ **Vercel Ready**: Configured for deployment on Vercel serverless platform
- 🔄 **Continuous Improvement**: Feedback system for improving OCR accuracy
## Project Structure
```
transactions-analyzer/
├── frontend/          # React UI application
│   ├── src/           # Frontend source code
│   ├── index.html
│   └── vite.config.js
├── utils/             # Utility modules
│   ├── tesseractManager.js   # OCR text extraction
│   └── improvementLogic.js   # Feedback handling
├── assets/            # Storage for images, PDFs, and uploads
├── scanner.js         # Core analysis engine
├── server.js          # Express API server
├── vercel.json        # Vercel deployment configuration
└── package.json       # Project dependencies
```
## Prerequisites
- Node.js 20.x or higher
- npm or yarn
## Installation
1. Clone the repository:
```bash
git clone <repository-url>
cd transactions-analyzer
```
2. Install dependencies:
```bash
npm install
```
3. Install frontend dependencies:
```bash
npm run build:ui
```
## Usage
### Development Mode
Run the backend server in development mode with hot-reload:
```bash
npm run dev
```
Run the scanner independently:
```bash
npm run scanner
```
Run the frontend development server:
```bash
npm run dev:ui
```
### Production Build
Build the frontend:
```bash
npm run build
```
Start the production server:
```bash
npm start
```
## API Endpoints
The server exposes REST APIs for document upload and analysis. See `server.js` for detailed endpoint documentation.
## Deployment
### Vercel
This project is pre-configured for Vercel deployment. Simply connect your repository to Vercel and deploy.
Configuration in `vercel.json`:
- Serverless function timeout: 60 seconds
- Memory allocation: 3008 MB
- Node.js version: 20.x
## Technologies Used
### Backend
- **Express.js** - Web framework
- **Multer** - File upload handling
- **Sharp** - Image processing
- **Tesseract.js** - OCR engine
- **PDF-parse** - PDF text extraction
- **Cors** - Cross-origin resource sharing
### Frontend
- **React 18** - UI library
- **Vite** - Build tool and dev server
## Scripts
| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start development server with nodemon |
| `npm run scanner` | Run the document scanner |
| `npm run dev:scanner` | Run scanner in watch mode |
| `npm run dev:ui` | Start frontend dev server |
| `npm run build:ui` | Build frontend for production |
| `npm run build` | Build the entire project |
## License
ISC
