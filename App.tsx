import { GoogleGenAI, Modality } from '@google/genai';
import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ArrowRight, Code2, Image as ImageIcon, FileText, Database, Terminal, Globe, Activity, Search, History, ShieldAlert, Settings, Mic, Volume2, Play, SquareTerminal, UploadCloud, Link as LinkIcon, CheckCircle2, AlertCircle, Building2, Wallet, FileSearch, Lock, Monitor, MonitorOff, ArrowLeft, BookOpen, Users, Briefcase } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Types & Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Provider = 'gemini' | 'openai' | 'anthropic' | 'groq' | 'local';
type ArtifactType = 'code' | 'image' | 'document' | 'data' | 'system' | 'python';

interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  content: string;
  status: 'pending' | 'generating' | 'reviewing' | 'complete' | 'error';
  iterations?: number;
  executionResult?: string;
  isExecuting?: boolean;
}

interface ApiKeys {
  gemini: string;
  openai: string;
  anthropic: string;
  groq: string;
  localUrl: string;
  slackClientId?: string;
  stripeClientId?: string;
  confluenceClientId?: string;
  zendeskSubdomain?: string;
  zendeskEmail?: string;
  zendeskToken?: string;
  postgresUri?: string;
  snowflakeAccount?: string;
  snowflakeUsername?: string;
  snowflakePassword?: string;
  snowflakeDatabase?: string;
  snowflakeSchema?: string;
  snowflakeWarehouse?: string;
}

// --- Pyodide Setup ---
declare global {
  interface Window {
    loadPyodide: (config: { indexURL: string }) => Promise<any>;
  }
}

export default function App() {
  // --- State ---
  const [view, setView] = useState<'landing' | 'app' | 'docs'>('landing');
  const [query, setQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [systemLog, setSystemLog] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [history, setHistory] = useState<{role: string, parts: {text: string}[]}[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  
  // File Upload (Vision)
  const [uploadedFiles, setUploadedFiles] = useState<{name: string, mimeType: string, data: string}[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Settings & Providers
  const [showSettings, setShowSettings] = useState(false);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [connectedIntegrations, setConnectedIntegrations] = useState<Record<string, boolean>>({
    slack: false,
    stripe: false,
    confluence: false,
    zendesk: false,
    postgres: false,
    snowflake: false
  });
  const [activeProvider, setActiveProvider] = useState<Provider>('gemini');
  const [apiKeys, setApiKeys] = useState<ApiKeys>({
    gemini: process.env.GEMINI_API_KEY || '',
    openai: '',
    anthropic: '',
    groq: '',
    localUrl: 'http://localhost:11434/v1',
    slackClientId: '',
    stripeClientId: '',
    confluenceClientId: '',
    zendeskSubdomain: '',
    zendeskEmail: '',
    zendeskToken: '',
    postgresUri: '',
    snowflakeAccount: '',
    snowflakeUsername: '',
    snowflakePassword: '',
    snowflakeDatabase: '',
    snowflakeSchema: '',
    snowflakeWarehouse: ''
  });

  // Screen Share (Vision)
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Voice & Audio
  const [isListening, setIsListening] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Python Execution
  const [pyodide, setPyodide] = useState<any>(null);
  const [isPyodideLoading, setIsPyodideLoading] = useState(false);

  // --- Initialization ---
  useEffect(() => {
    const savedKeys = localStorage.getItem('dar_api_keys');
    if (savedKeys) {
      try {
        const parsed = JSON.parse(savedKeys);
        setApiKeys(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error("Failed to parse saved API keys");
      }
    }
    const savedProvider = localStorage.getItem('dar_active_provider');
    if (savedProvider) {
      setActiveProvider(savedProvider as Provider);
    }

    const initPyodide = async () => {
      if (window.loadPyodide) return;
      setIsPyodideLoading(true);
      try {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js';
        script.onload = async () => {
          const py = await window.loadPyodide({
            indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/'
          });
          await py.loadPackage(['numpy', 'pandas', 'scipy', 'matplotlib']);
          setPyodide(py);
          setIsPyodideLoading(false);
          addLog("SECURE PYTHON ENVIRONMENT (PYODIDE) LOADED.");
        };
        document.body.appendChild(script);
      } catch (err) {
        console.error("Failed to load Pyodide", err);
        setIsPyodideLoading(false);
      }
    };
    initPyodide();

    // OAuth Message Listener
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        const provider = event.data.provider;
        setConnectedIntegrations(prev => ({ ...prev, [provider]: true }));
        addLog(`INTEGRATION SUCCESS: ${provider.toUpperCase()} CONNECTED.`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [systemLog]);

  const addLog = (msg: string) => {
    setSystemLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const handleSaveSettings = () => {
    localStorage.setItem('dar_api_keys', JSON.stringify(apiKeys));
    localStorage.setItem('dar_active_provider', activeProvider);
    setShowSettings(false);
    addLog(`CONFIGURATION SAVED. ACTIVE PROVIDER: ${activeProvider.toUpperCase()}`);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64Data = (event.target?.result as string).split(',')[1];
        setUploadedFiles(prev => [...prev, { name: file.name, mimeType: file.type, data: base64Data }]);
        addLog(`FILE UPLOADED: ${file.name} (${file.type})`);
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleOAuthConnect = async (provider: string) => {
    if (provider === 'zendesk') {
      if (apiKeys.zendeskSubdomain && apiKeys.zendeskEmail && apiKeys.zendeskToken) {
        setConnectedIntegrations(prev => ({ ...prev, zendesk: true }));
        addLog(`INTEGRATION SUCCESS: ZENDESK CONNECTED.`);
      } else {
        addLog(`ERROR: ZENDESK CREDENTIALS MISSING IN SETTINGS.`);
      }
      return;
    }

    if (provider === 'postgres') {
      if (apiKeys.postgresUri) {
        setConnectedIntegrations(prev => ({ ...prev, postgres: true }));
        addLog(`INTEGRATION SUCCESS: POSTGRESQL CONNECTED.`);
      } else {
        addLog(`ERROR: POSTGRESQL URI MISSING IN SETTINGS.`);
      }
      return;
    }

    if (provider === 'snowflake') {
      if (apiKeys.snowflakeAccount && apiKeys.snowflakeUsername && apiKeys.snowflakePassword) {
        setConnectedIntegrations(prev => ({ ...prev, snowflake: true }));
        addLog(`INTEGRATION SUCCESS: SNOWFLAKE CONNECTED.`);
      } else {
        addLog(`ERROR: SNOWFLAKE CREDENTIALS MISSING IN SETTINGS.`);
      }
      return;
    }

    try {
      let clientId = '';
      if (provider === 'slack') clientId = apiKeys.slackClientId || '';
      if (provider === 'stripe') clientId = apiKeys.stripeClientId || '';
      if (provider === 'confluence') clientId = apiKeys.confluenceClientId || '';

      const queryParams = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const res = await fetch(`/api/auth/${provider}/url${queryParams}`);
      if (!res.ok) throw new Error('Failed to get auth URL');
      const { url } = await res.json();
      window.open(url, 'oauth_popup', 'width=600,height=700');
    } catch (err) {
      console.error(err);
      addLog(`ERROR: FAILED TO INITIATE ${provider.toUpperCase()} OAUTH.`);
    }
  };

  // --- Screen Share Logic ---
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      const stream = videoRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
      setIsScreenSharing(false);
      if (videoRef.current) videoRef.current.srcObject = null;
      addLog("SCREEN SHARE STOPPED.");
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        setIsScreenSharing(true);
        addLog("SCREEN SHARE STARTED. VISION CONTEXT ACTIVE.");
        stream.getVideoTracks()[0].onended = () => {
          setIsScreenSharing(false);
          addLog("SCREEN SHARE ENDED.");
        };
      } catch (err) {
        console.error("Error sharing screen:", err);
        addLog("ERROR: FAILED TO START SCREEN SHARE.");
      }
    }
  };

  const captureScreen = (): string | null => {
    if (!isScreenSharing || !videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      return dataUrl.split(',')[1];
    }
    return null;
  };

  // --- Unified LLM Call Wrapper ---
  const generateText = async (prompt: string, systemInstruction?: string, useSearch: boolean = false, includeFiles: boolean = false): Promise<string> => {
    if (activeProvider === 'gemini') {
      const ai = new GoogleGenAI({ apiKey: apiKeys.gemini || process.env.GEMINI_API_KEY || '' });
      
      let contents: any = prompt;
      if (includeFiles) {
        const parts: any[] = [];
        if (uploadedFiles.length > 0) {
          parts.push(...uploadedFiles.map(f => ({ inlineData: { mimeType: f.mimeType, data: f.data } })));
        }
        const screenFrame = captureScreen();
        if (screenFrame) {
          parts.push({ inlineData: { mimeType: 'image/jpeg', data: screenFrame } });
          addLog("CAPTURED SCREEN FRAME FOR VISION CONTEXT.");
        }
        if (parts.length > 0) {
          parts.push({ text: prompt });
          contents = { parts };
        }
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents,
        config: {
          systemInstruction,
          tools: useSearch ? [{ googleSearch: {} }] : undefined,
        }
      });
      return response.text || '';
    } 
    
    if (activeProvider === 'openai') {
      if (!apiKeys.openai) throw new Error("OpenAI API Key missing");
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKeys.openai}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
            { role: 'user', content: prompt }
          ]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      return data.choices[0].message.content;
    }

    if (activeProvider === 'local') {
      const res = await fetch(`${apiKeys.localUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3',
          messages: [
            ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
            { role: 'user', content: prompt }
          ]
        })
      });
      const data = await res.json();
      return data.choices[0].message.content;
    }

    throw new Error(`Provider ${activeProvider} not fully implemented in this demo.`);
  };

  // --- Voice Input (Speech to Text) ---
  const toggleListening = () => {
    if (isListening) {
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);
    
    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((result: any) => result[0])
        .map((result: any) => result.transcript)
        .join('');
      setQuery(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognition.start();
  };

  // --- Voice Output (Text to Speech via Gemini) ---
  const speakText = async (text: string) => {
    if (!apiKeys.gemini && !process.env.GEMINI_API_KEY) return;
    
    try {
      const ai = new GoogleGenAI({ apiKey: apiKeys.gemini || process.env.GEMINI_API_KEY || '' });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const url = `data:audio/mp3;base64,${base64Audio}`;
        setAudioUrl(url);
        setTimeout(() => audioRef.current?.play(), 100);
      }
    } catch (e) {
      console.error("TTS Error:", e);
    }
  };

  // --- Python Execution ---
  const executePython = async (artifactId: string, code: string) => {
    if (!pyodide) {
      addLog("ERROR: Python environment not loaded yet.");
      return;
    }

    setArtifacts(prev => prev.map(a => 
      a.id === artifactId ? { ...a, isExecuting: true, executionResult: 'Running...' } : a
    ));

    try {
      pyodide.runPython(`
        import sys
        import io
        sys.stdout = io.StringIO()
      `);

      await pyodide.runPythonAsync(code);

      const stdout = pyodide.runPython("sys.stdout.getvalue()");
      
      setArtifacts(prev => prev.map(a => 
        a.id === artifactId ? { ...a, isExecuting: false, executionResult: stdout || 'Execution completed with no output.' } : a
      ));
      addLog(`PYTHON EXECUTION COMPLETE FOR ARTIFACT ${artifactId}`);
    } catch (err: any) {
      setArtifacts(prev => prev.map(a => 
        a.id === artifactId ? { ...a, isExecuting: false, executionResult: `Error:\n${err.message}` } : a
      ));
      addLog(`PYTHON EXECUTION FAILED FOR ARTIFACT ${artifactId}`);
    }
  };

  // --- Main Manifestation Logic ---
  const handleManifest = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsGenerating(true);
    setSystemLog([]);
    setArtifacts([]);
    
    addLog(`INITIALIZING AGENT WORKFLOW FOR: "${query}" USING ${activeProvider.toUpperCase()}`);
    
    speakText(`Initiating workflow for: ${query}. Engaging orchestrator node.`);

    try {
      addLog('ANALYZING INTENT & REQUIRED INTEGRATIONS...');
      
      const orchestratorPrompt = `You are the Lead Agent Orchestrator. The user wants to execute: "${query}".
      Consider any previous context in this conversation if relevant.
      Break this down into 3-5 distinct, tangible tasks needed to complete this workflow.
      Return ONLY a JSON array of objects with 'type' (must be 'code', 'image', 'document', 'data', or 'python'), 'title', and 'prompt' (detailed instructions for the specialized agent to generate this artifact).
      If the user asks for data analysis, reconciliation, or backend logic, use type 'python'.
      If the user asks for a report, use type 'document'.`;

      const currentTurn = { role: 'user', parts: [{ text: orchestratorPrompt }] };
      const conversationContext = [...history, currentTurn];
      const contextString = JSON.stringify(conversationContext);

      const orchestratorResponseText = await generateText(
        `Context: ${contextString}\n\nPrompt: ${orchestratorPrompt}`, 
        "You are a master planner for a deterministic AI runtime. Deconstruct complex goals into actionable, parallelizable tasks. Output valid JSON only. Strip markdown formatting like ```json. If the user asks to interact with Zendesk, Postgres, or Snowflake, include a task of type 'data' with a prompt instructing the agent to use the respective tools.",
        true,
        true // Include files for vision/context
      );

      const cleanedJson = orchestratorResponseText.replace(/```json/g, '').replace(/```/g, '').trim();

      let plan: { type: ArtifactType, title: string, prompt: string }[] = [];
      try {
        plan = JSON.parse(cleanedJson);
        addLog(`ORCHESTRATOR IDENTIFIED ${plan.length} REQUIRED TASKS.`);
      } catch (e) {
        addLog(`ERROR: ORCHESTRATOR FAILED TO PRODUCE VALID PLAN. Raw output: ${cleanedJson}`);
        throw new Error('Failed to parse orchestrator plan');
      }

      setHistory([...conversationContext, { role: 'model', parts: [{ text: cleanedJson }] }]);

      const initialArtifacts: Artifact[] = plan.map((item, i) => ({
        id: `art-${Date.now()}-${i}`,
        type: item.type,
        title: item.title,
        content: '',
        status: 'pending',
        iterations: 0
      }));
      setArtifacts(initialArtifacts);

      addLog('SPAWNING SPECIALIZED AGENTS FOR PARALLEL EXECUTION...');
      
      await Promise.all(plan.map(async (task, index) => {
        const artifactId = initialArtifacts[index].id;
        
        setArtifacts(prev => prev.map(a => 
          a.id === artifactId ? { ...a, status: 'generating', iterations: 1 } : a
        ));
        addLog(`AGENT [${task.type.toUpperCase()}] STARTED: ${task.title}`);

        try {
          if (task.type === 'image') {
            const ai = new GoogleGenAI({ apiKey: apiKeys.gemini || process.env.GEMINI_API_KEY || '' });
            const imgResponse = await ai.models.generateContent({
              model: 'gemini-2.5-flash-image',
              contents: task.prompt,
              config: { imageConfig: { aspectRatio: "16:9", imageSize: "1K" } }
            });
            
            let imageUrl = '';
            for (const part of imgResponse.candidates?.[0]?.content?.parts || []) {
              if (part.inlineData) {
                imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
                break;
              }
            }

            setArtifacts(prev => prev.map(a => 
              a.id === artifactId ? { ...a, status: 'complete', content: imageUrl } : a
            ));
            addLog(`AGENT [IMAGE] COMPLETED: ${task.title}`);

          } else {
            let content = '';
            let success = false;
            let attempts = 0;
            const maxAttempts = 2;
            let currentPrompt = task.prompt;

            while (attempts < maxAttempts && !success) {
              attempts++;
              
              if (attempts > 1) {
                setArtifacts(prev => prev.map(a => 
                  a.id === artifactId ? { ...a, status: 'generating', iterations: attempts } : a
                ));
              }

              const sysInstruction = task.type === 'python' 
                ? `You are a Python expert working in a secure deterministic environment. Provide ONLY valid Python code. Do not wrap in markdown blocks. Do not explain. Just the raw python code.`
                : `You are a specialized deterministic agent creating a ${task.type} artifact. Provide ONLY the requested content. No conversational filler. If code, provide just the code block. If document, provide the markdown.`;

              const textResponse = await generateText(currentPrompt, sysInstruction);
              
              content = task.type === 'python' 
                ? textResponse.replace(/```python/g, '').replace(/```/g, '').trim()
                : textResponse;

              setArtifacts(prev => prev.map(a => 
                a.id === artifactId ? { ...a, status: 'reviewing' } : a
              ));
              addLog(`COMPLIANCE REVIEWING [${task.type.toUpperCase()}]: ${task.title} (Attempt ${attempts})`);

              const criticResponse = await generateText(
                `Review this ${task.type} artifact based on the original prompt: "${task.prompt}".\n\nArtifact Content:\n${content}\n\nIs this a high-quality, secure, and accurate response suitable for an enterprise environment? If it is good, reply with exactly "APPROVED". If it is incomplete, incorrect, or poses a risk, reply with "REJECTED: <specific reason>".`,
                "You are a strict Compliance & QA Officer. Your job is to ensure high quality and security."
              );

              const feedback = criticResponse;
              
              if (feedback.includes('REJECTED') && attempts < maxAttempts) {
                addLog(`COMPLIANCE REJECTED [${task.type.toUpperCase()}]: ${task.title}. RE-GENERATING...`);
                currentPrompt = `${task.prompt}\n\nCOMPLIANCE FEEDBACK FROM PREVIOUS ATTEMPT: ${feedback}\nPlease fix these issues and generate again.`;
              } else {
                success = true;
                if (feedback.includes('REJECTED')) {
                  addLog(`COMPLIANCE REJECTED [${task.type.toUpperCase()}] BUT MAX ATTEMPTS REACHED. PROCEEDING WITH WARNING.`);
                } else {
                  addLog(`COMPLIANCE APPROVED [${task.type.toUpperCase()}]: ${task.title}`);
                }
              }
            }

            setArtifacts(prev => prev.map(a => 
              a.id === artifactId ? { ...a, status: 'complete', content: content } : a
            ));
            addLog(`AGENT [${task.type.toUpperCase()}] COMPLETED: ${task.title}`);
          }
        } catch (err) {
          addLog(`ERROR: AGENT [${task.type.toUpperCase()}] FAILED ON ${task.title}`);
          setArtifacts(prev => prev.map(a => 
            a.id === artifactId ? { ...a, status: 'error', content: 'Failed to generate artifact.' } : a
          ));
        }
      }));

      addLog('ALL AGENTS TERMINATED. WORKFLOW COMPLETE.');
      speakText("Workflow complete. All tasks have been executed successfully.");

    } catch (error: any) {
      console.error('Agent Error:', error);
      addLog(`CRITICAL ERROR: ${error.message}`);
      speakText("A critical error occurred during the workflow.");
    } finally {
      setIsGenerating(false);
      setQuery('');
    }
  };

  const getIcon = (type: ArtifactType) => {
    switch (type) {
      case 'code': return <Code2 className="w-4 h-4" />;
      case 'python': return <SquareTerminal className="w-4 h-4 text-blue-600" />;
      case 'image': return <ImageIcon className="w-4 h-4" />;
      case 'document': return <FileText className="w-4 h-4" />;
      case 'data': return <Database className="w-4 h-4" />;
      default: return <Terminal className="w-4 h-4" />;
    }
  };

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-[#f5f5f4] text-[#0a0a0a] font-sans flex flex-col">
        {/* Hero Section */}
        <div className="flex flex-col md:flex-row min-h-screen">
          {/* Left Pane: Content */}
          <div className="flex-1 p-8 md:p-16 flex flex-col justify-center relative z-10">
            <div className="max-w-xl">
              <div className="flex items-center gap-3 mb-12">
                <div className="w-12 h-12 bg-[#0a0a0a] rounded-xl flex items-center justify-center shadow-lg">
                  <Terminal className="w-6 h-6 text-white" />
                </div>
                <span className="font-semibold text-xl tracking-tight">Deterministic Agent Runtime</span>
              </div>
              
              <h1 className="text-6xl md:text-7xl font-bold leading-[0.9] tracking-tighter mb-8">
                Build<br/>Reliable<br/>AI Agents.
              </h1>
              
              <p className="text-lg text-gray-600 mb-12 max-w-md leading-relaxed">
                An open-source, privacy-first runtime for deterministic AI agents. Connect enterprise data, build specialized workflows, and execute Python securely in the browser.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4">
                <button 
                  onClick={() => setView('app')}
                  className="px-8 py-4 bg-[#0a0a0a] text-white rounded-full font-medium flex items-center justify-center gap-2 hover:bg-gray-800 transition-all hover:scale-105 active:scale-95 shadow-xl"
                >
                  Launch Workspace <ArrowRight className="w-5 h-5" />
                </button>
                <button 
                  onClick={() => setView('docs')}
                  className="px-8 py-4 bg-white border border-gray-200 text-[#0a0a0a] rounded-full font-medium hover:bg-gray-50 transition-colors shadow-sm flex items-center justify-center gap-2"
                >
                  <BookOpen className="w-5 h-5" /> View Documentation
                </button>
              </div>

              <div className="mt-16 flex items-center gap-6 text-sm font-medium text-gray-500">
                <span className="flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-emerald-500" /> SOC2 Ready</span>
                <span className="flex items-center gap-2"><Lock className="w-4 h-4 text-blue-500" /> Local Execution</span>
                <span className="flex items-center gap-2"><Terminal className="w-4 h-4 text-purple-500" /> Pyodide Sandbox</span>
              </div>
            </div>
          </div>

          {/* Right Pane: Graphic */}
          <div className="flex-1 bg-[#0a0a0a] text-white relative overflow-hidden flex items-center justify-center p-8 md:p-16">
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', backgroundSize: '24px 24px' }}></div>
            
            <div className="relative z-10 w-full max-w-lg">
              {/* Floating Feature Bubbles */}
              <motion.div 
                initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}
                className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 mb-6 transform -rotate-2 shadow-2xl"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                    <FileSearch className="w-4 h-4 text-emerald-400" />
                  </div>
                  <span className="font-medium text-sm">Document Vision Agent</span>
                </div>
                <div className="h-2 bg-white/10 rounded-full w-3/4 mb-2"></div>
                <div className="h-2 bg-white/10 rounded-full w-1/2"></div>
              </motion.div>

              <motion.div 
                initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.4 }}
                className="bg-white/10 backdrop-blur-md border border-white/20 rounded-2xl p-6 transform rotate-1 shadow-2xl ml-8"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center">
                    <SquareTerminal className="w-4 h-4 text-blue-400" />
                  </div>
                  <span className="font-medium text-sm">Data Processing Script (Python)</span>
                </div>
                <pre className="text-[10px] font-mono text-gray-400 bg-black/30 p-3 rounded-lg">
                  <code>
                    import pandas as pd<br/>
                    df = pd.read_csv('stripe.csv')<br/>
                    anomalies = df[df['amount'] &gt; 10000]<br/>
                    print(anomalies)
                  </code>
                </pre>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Benefits Section */}
        <div className="bg-white py-24 px-8 md:px-16 border-t border-gray-200">
          <div className="max-w-7xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-4xl font-bold tracking-tight text-[#0a0a0a] mb-4">Built for Enterprise Workflows</h2>
              <p className="text-lg text-gray-500 max-w-2xl mx-auto">Connect your tools, share your screen, and let deterministic agents handle the heavy lifting across your entire stack.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
              {/* Customer Support */}
              <div className="flex flex-col gap-4">
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center border border-blue-100 mb-2">
                  <Users className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="text-xl font-semibold">Customer Support</h3>
                <p className="text-gray-600 leading-relaxed">
                  Share your screen while viewing a customer's profile. The agent instantly reads the context, searches <strong className="text-gray-900">Zendesk</strong> for open tickets, and drafts a resolution directly into the ticket.
                </p>
              </div>

              {/* Operations */}
              <div className="flex flex-col gap-4">
                <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-100 mb-2">
                  <Briefcase className="w-6 h-6 text-emerald-600" />
                </div>
                <h3 className="text-xl font-semibold">Operations & Finance</h3>
                <p className="text-gray-600 leading-relaxed">
                  Connect <strong className="text-gray-900">Stripe</strong> to analyze transactions. The agent writes and executes secure Python code locally via Pyodide to find anomalies, then posts the report to <strong className="text-gray-900">Slack</strong>.
                </p>
              </div>

              {/* Engineering */}
              <div className="flex flex-col gap-4">
                <div className="w-12 h-12 bg-purple-50 rounded-xl flex items-center justify-center border border-purple-100 mb-2">
                  <Code2 className="w-6 h-6 text-purple-600" />
                </div>
                <h3 className="text-xl font-semibold">Engineering & Product</h3>
                <p className="text-gray-600 leading-relaxed">
                  Upload architectural diagrams or error logs. The agent references <strong className="text-gray-900">Confluence</strong> documentation to find solutions and generates step-by-step remediation plans.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'docs') {
    return (
      <div className="min-h-screen bg-[#f5f5f4] text-[#0a0a0a] font-sans p-8 md:p-16">
        <div className="max-w-4xl mx-auto bg-white border border-gray-200 rounded-2xl p-8 md:p-12 shadow-xl">
          <button 
            onClick={() => setView('landing')} 
            className="mb-8 flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Home
          </button>
          
          <h1 className="text-4xl font-bold mb-4 tracking-tight">Platform Documentation</h1>
          <p className="text-lg text-gray-600 mb-12">Learn how to configure LLM providers, set up enterprise integrations, and use advanced features like Screen Sharing and Python execution.</p>

          <div className="space-y-12">
            {/* Section 1: LLM Providers */}
            <section>
              <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2 border-b border-gray-100 pb-4">
                <Terminal className="w-6 h-6 text-blue-600" /> 1. LLM Providers
              </h2>
              <p className="text-gray-600 mb-4">The runtime requires an API key from at least one supported provider. We recommend Google Gemini for full multimodal support (Vision, Audio).</p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="block p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors">
                  <h3 className="font-semibold mb-1">Google Gemini (Recommended)</h3>
                  <p className="text-sm text-gray-500">Get your API key from Google AI Studio.</p>
                </a>
                <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer" className="block p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors">
                  <h3 className="font-semibold mb-1">OpenAI</h3>
                  <p className="text-sm text-gray-500">Get your API key from the OpenAI Platform.</p>
                </a>
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="block p-4 border border-gray-200 rounded-xl hover:border-blue-300 hover:bg-blue-50 transition-colors">
                  <h3 className="font-semibold mb-1">Anthropic</h3>
                  <p className="text-sm text-gray-500">Get your API key from the Anthropic Console.</p>
                </a>
              </div>
            </section>

            {/* Section 2: Enterprise Integrations */}
            <section>
              <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2 border-b border-gray-100 pb-4">
                <LinkIcon className="w-6 h-6 text-emerald-600" /> 2. Enterprise Integrations
              </h2>
              <p className="text-gray-600 mb-6">Connect external tools to allow the agent to read context and take actions. You will need to create OAuth apps or API tokens in your respective platforms.</p>
              
              <div className="space-y-6">
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-2">Zendesk</h3>
                  <p className="text-sm text-gray-600 mb-4">Allows the agent to search, read, and update support tickets.</p>
                  <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2">
                    <li>Go to your Zendesk Admin Center: <code className="bg-gray-200 px-1.5 py-0.5 rounded">https://[your-subdomain].zendesk.com/admin/apps-integrations/apis/zendesk-api/settings</code></li>
                    <li>Enable <strong>Token Access</strong>.</li>
                    <li>Create a new API token and copy it.</li>
                    <li>In the App Settings, enter your Subdomain, Admin Email, and the API Token.</li>
                  </ol>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-2">Slack</h3>
                  <p className="text-sm text-gray-600 mb-4">Allows the agent to read channels and post messages.</p>
                  <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2">
                    <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Slack API Apps</a> and create a new app.</li>
                    <li>Under "OAuth & Permissions", add the <code className="bg-gray-200 px-1.5 py-0.5 rounded">channels:read</code> and <code className="bg-gray-200 px-1.5 py-0.5 rounded">chat:write</code> scopes.</li>
                    <li>Copy the <strong>Client ID</strong> from "Basic Information" into the App Settings.</li>
                  </ol>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-2">Stripe</h3>
                  <p className="text-sm text-gray-600 mb-4">Allows the agent to analyze transactions and process refunds.</p>
                  <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2">
                    <li>Go to the <a href="https://dashboard.stripe.com/settings/connect" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Stripe Connect Settings</a>.</li>
                    <li>Copy your <strong>Live mode client ID</strong> (or Test mode) into the App Settings.</li>
                  </ol>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-2">Confluence</h3>
                  <p className="text-sm text-gray-600 mb-4">Allows the agent to search and read internal documentation.</p>
                  <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2">
                    <li>Go to the <a href="https://developer.atlassian.com/console/myapps/" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Atlassian Developer Console</a>.</li>
                    <li>Create a new <strong>OAuth 2.0 (3LO)</strong> app.</li>
                    <li>Copy the <strong>Client ID</strong> into the App Settings.</li>
                  </ol>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-xl p-6">
                  <h3 className="text-lg font-semibold mb-2">Databases (PostgreSQL & Snowflake)</h3>
                  <p className="text-sm text-gray-600 mb-4">Allows the agent to query your databases directly to analyze data or generate reports.</p>
                  <ol className="list-decimal list-inside text-sm text-gray-600 space-y-2">
                    <li>For <strong>PostgreSQL</strong>, enter your connection URI in the App Settings.</li>
                    <li>For <strong>Snowflake</strong>, enter your Account, Username, Password, Database, Schema, and Warehouse in the App Settings.</li>
                  </ol>
                </div>
              </div>
            </section>

            {/* Section 3: Advanced Features */}
            <section>
              <h2 className="text-2xl font-semibold mb-6 flex items-center gap-2 border-b border-gray-100 pb-4">
                <Monitor className="w-6 h-6 text-purple-600" /> 3. Advanced Capabilities
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="border border-gray-200 rounded-xl p-6">
                  <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center mb-4">
                    <Monitor className="w-5 h-5 text-purple-600" />
                  </div>
                  <h3 className="font-semibold mb-2">Screen Sharing (Vision)</h3>
                  <p className="text-sm text-gray-600">Click the monitor icon in the input bar to share a specific window or your entire screen. When you submit a prompt, the agent captures a frame and uses it as visual context. Perfect for debugging errors or reading CRM data without API integration.</p>
                </div>

                <div className="border border-gray-200 rounded-xl p-6">
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center mb-4">
                    <SquareTerminal className="w-5 h-5 text-blue-600" />
                  </div>
                  <h3 className="font-semibold mb-2">Local Python Execution</h3>
                  <p className="text-sm text-gray-600">When the agent needs to analyze data or perform complex logic, it writes Python code. This code is executed entirely in your browser using <strong>Pyodide</strong> (a WebAssembly Python port), ensuring your data never leaves your machine.</p>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#1a1f36] font-sans selection:bg-blue-500/30 flex flex-col relative">
      
      {/* Audio Element for TTS */}
      <audio ref={audioRef} src={audioUrl || undefined} className="hidden" />

      {/* Hidden Video/Canvas for Screen Share */}
      <video ref={videoRef} className="hidden" muted playsInline />
      <canvas ref={canvasRef} className="hidden" />

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#1a1f36]/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-md shadow-2xl"
            >
              <h2 className="text-xl font-semibold mb-4 flex items-center gap-2 text-[#1a1f36]">
                <Settings className="w-5 h-5" /> Platform Configuration
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Active Provider</label>
                  <select 
                    value={activeProvider}
                    onChange={(e) => setActiveProvider(e.target.value as Provider)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  >
                    <option value="gemini">Google Gemini (Recommended)</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="local">Local (Ollama/LMStudio) - Privacy First</option>
                  </select>
                </div>

                <div className="space-y-3 pt-4 border-t border-gray-100">
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">API Keys (Stored Locally)</label>
                  
                  <input
                    type="password"
                    placeholder="Gemini API Key"
                    value={apiKeys.gemini}
                    onChange={(e) => setApiKeys({...apiKeys, gemini: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  <input
                    type="password"
                    placeholder="OpenAI API Key"
                    value={apiKeys.openai}
                    onChange={(e) => setApiKeys({...apiKeys, openai: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  <input
                    type="password"
                    placeholder="Anthropic API Key"
                    value={apiKeys.anthropic}
                    onChange={(e) => setApiKeys({...apiKeys, anthropic: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  {activeProvider === 'local' && (
                    <input
                      type="text"
                      placeholder="Local API URL (e.g., http://localhost:11434/v1)"
                      value={apiKeys.localUrl}
                      onChange={(e) => setApiKeys({...apiKeys, localUrl: e.target.value})}
                      className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                  )}
                </div>

                <div className="space-y-3 pt-4 border-t border-gray-100">
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Integration Credentials (OAuth)</label>
                  
                  <input
                    type="text"
                    placeholder="Slack Client ID"
                    value={apiKeys.slackClientId || ''}
                    onChange={(e) => setApiKeys({...apiKeys, slackClientId: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  <input
                    type="text"
                    placeholder="Stripe Client ID"
                    value={apiKeys.stripeClientId || ''}
                    onChange={(e) => setApiKeys({...apiKeys, stripeClientId: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  <input
                    type="text"
                    placeholder="Confluence Client ID"
                    value={apiKeys.confluenceClientId || ''}
                    onChange={(e) => setApiKeys({...apiKeys, confluenceClientId: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                </div>

                <div className="space-y-3 pt-4 border-t border-gray-100">
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Zendesk Credentials</label>
                  
                  <input
                    type="text"
                    placeholder="Subdomain (e.g., mycompany)"
                    value={apiKeys.zendeskSubdomain || ''}
                    onChange={(e) => setApiKeys({...apiKeys, zendeskSubdomain: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  <input
                    type="email"
                    placeholder="Admin Email"
                    value={apiKeys.zendeskEmail || ''}
                    onChange={(e) => setApiKeys({...apiKeys, zendeskEmail: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  <input
                    type="password"
                    placeholder="API Token"
                    value={apiKeys.zendeskToken || ''}
                    onChange={(e) => setApiKeys({...apiKeys, zendeskToken: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                </div>

                <div className="space-y-3 pt-4 border-t border-gray-100">
                  <label className="block text-xs font-medium text-gray-500 mb-1 uppercase tracking-wider">Database Credentials</label>
                  
                  <input
                    type="text"
                    placeholder="PostgreSQL URI (e.g., postgresql://user:pass@host:5432/db)"
                    value={apiKeys.postgresUri || ''}
                    onChange={(e) => setApiKeys({...apiKeys, postgresUri: e.target.value})}
                    className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      placeholder="Snowflake Account"
                      value={apiKeys.snowflakeAccount || ''}
                      onChange={(e) => setApiKeys({...apiKeys, snowflakeAccount: e.target.value})}
                      className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                    <input
                      type="text"
                      placeholder="Snowflake Username"
                      value={apiKeys.snowflakeUsername || ''}
                      onChange={(e) => setApiKeys({...apiKeys, snowflakeUsername: e.target.value})}
                      className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                    <input
                      type="password"
                      placeholder="Snowflake Password"
                      value={apiKeys.snowflakePassword || ''}
                      onChange={(e) => setApiKeys({...apiKeys, snowflakePassword: e.target.value})}
                      className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                    <input
                      type="text"
                      placeholder="Snowflake Database"
                      value={apiKeys.snowflakeDatabase || ''}
                      onChange={(e) => setApiKeys({...apiKeys, snowflakeDatabase: e.target.value})}
                      className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                    <input
                      type="text"
                      placeholder="Snowflake Schema"
                      value={apiKeys.snowflakeSchema || ''}
                      onChange={(e) => setApiKeys({...apiKeys, snowflakeSchema: e.target.value})}
                      className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                    <input
                      type="text"
                      placeholder="Snowflake Warehouse"
                      value={apiKeys.snowflakeWarehouse || ''}
                      onChange={(e) => setApiKeys({...apiKeys, snowflakeWarehouse: e.target.value})}
                      className="w-full bg-white border border-gray-200 rounded-lg p-2.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3">
                <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors">Cancel</button>
                <button onClick={handleSaveSettings} className="px-4 py-2 bg-[#635BFF] text-white font-medium text-sm rounded-lg hover:bg-[#4B45D6] transition-colors shadow-sm">Save Configuration</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Integrations Modal */}
      <AnimatePresence>
        {showIntegrations && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-[#1a1f36]/40 backdrop-blur-sm flex items-center justify-center p-4"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="bg-white border border-gray-200 rounded-2xl p-6 w-full max-w-2xl shadow-2xl"
            >
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold flex items-center gap-2 text-[#1a1f36]">
                  <LinkIcon className="w-5 h-5 text-blue-600" /> Connected Workspaces
                </h2>
                <button onClick={() => setShowIntegrations(false)} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              
              <p className="text-sm text-gray-500 mb-6">
                Connect your agents to external systems to read context and take actions automatically. OAuth flows are required for secure access.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Slack Integration */}
                <div className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white rounded-lg border border-gray-200 flex items-center justify-center shadow-sm">
                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#E01E5A"/></svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">Slack</h3>
                        <p className="text-xs text-gray-500">Read channels, post alerts</p>
                      </div>
                    </div>
                    {connectedIntegrations.slack ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded-full uppercase tracking-wider">Connected</span>
                    ) : (
                      <span className="px-2.5 py-1 bg-gray-200 text-gray-600 text-[10px] font-semibold rounded-full uppercase tracking-wider">Not Connected</span>
                    )}
                  </div>
                  <button 
                    onClick={() => handleOAuthConnect('slack')}
                    disabled={connectedIntegrations.slack}
                    className="w-full py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connectedIntegrations.slack ? 'Workspace Connected' : 'Connect Slack Workspace'}
                  </button>
                </div>

                {/* Confluence Integration */}
                <div className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white rounded-lg border border-gray-200 flex items-center justify-center shadow-sm">
                        <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 22.5c-5.799 0-10.5-4.701-10.5-10.5S6.201 1.5 12 1.5s10.5 4.701 10.5 10.5S17.799 22.5 12 22.5zm0-19.5c-4.962 0-9 4.038-9 9s4.038 9 9 9 9-4.038 9-9-4.038-9-9-9zm-3.5 13.5l3.5-6 3.5 6h-7z" fill="#172B4D"/></svg>
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">Confluence</h3>
                        <p className="text-xs text-gray-500">Read docs, write reports</p>
                      </div>
                    </div>
                    {connectedIntegrations.confluence ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded-full uppercase tracking-wider">Connected</span>
                    ) : (
                      <span className="px-2.5 py-1 bg-gray-200 text-gray-600 text-[10px] font-semibold rounded-full uppercase tracking-wider">Not Connected</span>
                    )}
                  </div>
                  <button 
                    onClick={() => handleOAuthConnect('confluence')}
                    disabled={connectedIntegrations.confluence}
                    className="w-full py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connectedIntegrations.confluence ? 'Confluence Connected' : 'Connect Confluence'}
                  </button>
                </div>

                {/* Stripe Integration */}
                <div className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#635BFF] rounded-lg border border-gray-200 flex items-center justify-center shadow-sm">
                        <span className="text-white font-bold text-lg">S</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">Stripe</h3>
                        <p className="text-xs text-gray-500">Read transactions, refunds</p>
                      </div>
                    </div>
                    {connectedIntegrations.stripe ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded-full uppercase tracking-wider">Connected</span>
                    ) : (
                      <span className="px-2.5 py-1 bg-gray-200 text-gray-600 text-[10px] font-semibold rounded-full uppercase tracking-wider">Not Connected</span>
                    )}
                  </div>
                  <button 
                    onClick={() => handleOAuthConnect('stripe')}
                    disabled={connectedIntegrations.stripe}
                    className="w-full py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connectedIntegrations.stripe ? 'Stripe Connected' : 'Connect Stripe Account'}
                  </button>
                </div>

                {/* Database Integration */}
                <div className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white rounded-lg border border-gray-200 flex items-center justify-center shadow-sm">
                        <Database className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">PostgreSQL</h3>
                        <p className="text-xs text-gray-500">Read/Write data access</p>
                      </div>
                    </div>
                    {connectedIntegrations.postgres ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded-full uppercase tracking-wider">Connected</span>
                    ) : (
                      <span className="px-2.5 py-1 bg-gray-200 text-gray-600 text-[10px] font-semibold rounded-full uppercase tracking-wider">Not Connected</span>
                    )}
                  </div>
                  <button 
                    onClick={() => handleOAuthConnect('postgres')}
                    disabled={connectedIntegrations.postgres}
                    className="w-full py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connectedIntegrations.postgres ? 'PostgreSQL Connected' : 'Connect via Settings'}
                  </button>
                </div>

                {/* Snowflake Integration */}
                <div className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#29B5E8] rounded-lg border border-gray-200 flex items-center justify-center shadow-sm">
                        <span className="text-white font-bold text-lg">❄</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">Snowflake</h3>
                        <p className="text-xs text-gray-500">Data warehouse queries</p>
                      </div>
                    </div>
                    {connectedIntegrations.snowflake ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded-full uppercase tracking-wider">Connected</span>
                    ) : (
                      <span className="px-2.5 py-1 bg-gray-200 text-gray-600 text-[10px] font-semibold rounded-full uppercase tracking-wider">Not Connected</span>
                    )}
                  </div>
                  <button 
                    onClick={() => handleOAuthConnect('snowflake')}
                    disabled={connectedIntegrations.snowflake}
                    className="w-full py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connectedIntegrations.snowflake ? 'Snowflake Connected' : 'Connect via Settings'}
                  </button>
                </div>

                {/* Zendesk Integration */}
                <div className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 transition-colors bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-[#03363D] rounded-lg border border-gray-200 flex items-center justify-center shadow-sm">
                        <span className="text-white font-bold text-lg">Z</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-sm">Zendesk</h3>
                        <p className="text-xs text-gray-500">Read/Update Tickets</p>
                      </div>
                    </div>
                    {connectedIntegrations.zendesk ? (
                      <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded-full uppercase tracking-wider">Connected</span>
                    ) : (
                      <span className="px-2.5 py-1 bg-gray-200 text-gray-600 text-[10px] font-semibold rounded-full uppercase tracking-wider">Not Connected</span>
                    )}
                  </div>
                  <button 
                    onClick={() => handleOAuthConnect('zendesk')}
                    disabled={connectedIntegrations.zendesk}
                    className="w-full py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {connectedIntegrations.zendesk ? 'Zendesk Connected' : 'Connect via Settings'}
                  </button>
                </div>
              </div>

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Navigation / Status Bar */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#635BFF]/10 border border-[#635BFF]/20">
              <Terminal className="w-5 h-5 text-[#635BFF]" />
            </div>
            <div>
              <h1 className="font-semibold text-[#1a1f36] leading-tight">Deterministic Agent Runtime</h1>
              <div className="flex items-center gap-2 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
                <span className="flex items-center gap-1"><ShieldAlert className="w-3 h-3 text-emerald-500" /> Secure Sandbox</span>
                <span>•</span>
                <span>{activeProvider}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setView('docs')} 
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-[#1a1f36] hover:bg-gray-50 rounded-lg transition-colors border border-transparent hover:border-gray-200"
            >
              <BookOpen className="w-4 h-4" /> Docs
            </button>
            <button 
              onClick={() => setShowIntegrations(true)} 
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-[#1a1f36] hover:bg-gray-50 rounded-lg transition-colors border border-transparent hover:border-gray-200"
            >
              <LinkIcon className="w-4 h-4" /> Integrations
            </button>
            <button 
              onClick={() => setShowSettings(true)} 
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-[#1a1f36] hover:bg-gray-50 rounded-lg transition-colors border border-transparent hover:border-gray-200"
            >
              <Settings className="w-4 h-4" /> Settings
            </button>
            <div className="h-6 w-px bg-gray-200 mx-1"></div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs font-medium text-gray-600">
              <Activity className={cn("w-3.5 h-3.5", isGenerating ? "text-blue-500 animate-pulse" : "text-gray-400")} />
              {isGenerating ? 'PROCESSING WORKFLOW' : 'SYSTEM IDLE'}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Input & Terminal */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          
          {/* Input Section */}
          <div className="bg-white border border-gray-200 rounded-2xl p-6 flex flex-col gap-4 shadow-sm relative overflow-hidden">
            {isListening && (
              <div className="absolute inset-0 bg-blue-50 flex items-center justify-center pointer-events-none z-0">
                <div className="w-32 h-32 rounded-full bg-blue-100 animate-ping" />
              </div>
            )}
            
            <div className="flex justify-between items-start relative z-10">
              <div>
                <h2 className="text-lg font-semibold text-[#1a1f36] mb-1">Agent Directive</h2>
                <p className="text-sm text-gray-500">Describe the operation or analysis.</p>
              </div>
              <div className="flex gap-2">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  className="hidden" 
                  multiple 
                  accept="image/*,.pdf,.csv"
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-full text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors border border-transparent hover:border-blue-100"
                  title="Upload Document (CSV, PDF, Image)"
                >
                  <UploadCloud className="w-5 h-5" />
                </button>
                <button 
                  onClick={toggleListening}
                  className={cn(
                    "p-2 rounded-full transition-colors border",
                    isListening ? "bg-red-50 border-red-200 text-red-500 animate-pulse" : "border-transparent text-gray-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100"
                  )}
                  title="Voice Command"
                >
                  <Mic className="w-5 h-5" />
                </button>
                <button 
                  onClick={toggleScreenShare}
                  className={cn(
                    "p-2 rounded-full transition-colors border",
                    isScreenSharing ? "bg-emerald-50 border-emerald-200 text-emerald-600 animate-pulse" : "border-transparent text-gray-400 hover:text-blue-600 hover:bg-blue-50 hover:border-blue-100"
                  )}
                  title="Share Screen for Vision Context"
                >
                  {isScreenSharing ? <Monitor className="w-5 h-5" /> : <MonitorOff className="w-5 h-5" />}
                </button>
              </div>
            </div>
            
            <form onSubmit={handleManifest} className="relative z-10">
              {uploadedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {uploadedFiles.map((file, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-lg text-xs font-medium text-blue-700">
                      <FileText className="w-3.5 h-3.5" />
                      <span className="max-w-[150px] truncate">{file.name}</span>
                      <button 
                        type="button" 
                        onClick={() => setUploadedFiles(prev => prev.filter((_, i) => i !== idx))}
                        className="text-blue-400 hover:text-blue-600 ml-1"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g., Process yesterday's Stripe transactions with our internal database, flag anomalies, and post a summary to the #operations Slack channel..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl p-4 text-sm text-[#1a1f36] placeholder:text-gray-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none resize-none h-36 transition-all shadow-inner"
                disabled={isGenerating}
              />
              <div className="absolute bottom-3 left-3 flex gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-gray-200 text-[10px] font-medium text-gray-500 shadow-sm">
                  <Wallet className="w-3 h-3" /> Transactions
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-gray-200 text-[10px] font-medium text-gray-500 shadow-sm">
                  <FileSearch className="w-3 h-3" /> Scanned Docs
                </span>
              </div>
              <button
                type="submit"
                disabled={!query.trim() || isGenerating}
                className="absolute bottom-3 right-3 px-4 py-2 bg-[#1a1f36] hover:bg-[#2a314d] text-white font-medium text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 shadow-sm"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    EXECUTING
                  </>
                ) : (
                  <>
                    Run Workflow
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          </div>

          {/* System Terminal */}
          <div className="bg-[#1a1f36] rounded-2xl flex flex-col flex-1 min-h-[300px] overflow-hidden shadow-lg border border-gray-800">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between bg-[#0f1322]">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-gray-400" />
                <span className="text-xs font-mono text-gray-400 tracking-wider uppercase">Execution Log</span>
              </div>
              {audioUrl && (
                <Volume2 className="w-4 h-4 text-blue-400 animate-pulse" />
              )}
            </div>
            <div className="p-4 font-mono text-[11px] text-gray-300 flex-1 overflow-y-auto space-y-2">
              {systemLog.length === 0 && (
                <div className="text-gray-600 italic">System ready. Awaiting workflow directive...</div>
              )}
              {systemLog.map((log, i) => {
                const isError = log.includes('ERROR') || log.includes('REJECTED');
                const isSuccess = log.includes('COMPLETE') || log.includes('APPROVED');
                return (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={i}
                    className={cn(
                      "pl-2 border-l-2",
                      isError ? "border-red-500 text-red-400" : isSuccess ? "border-emerald-500 text-emerald-400" : "border-gray-700"
                    )}
                  >
                    {log}
                  </motion.div>
                );
              })}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>

        {/* Right Column: Artifacts Grid */}
        <div className="lg:col-span-8">
          <div className="grid grid-cols-1 gap-6">
            <AnimatePresence>
              {artifacts.map((artifact) => (
                <motion.div
                  key={artifact.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "bg-white border rounded-2xl overflow-hidden flex flex-col shadow-sm transition-all duration-300",
                    (artifact.status === 'generating' || artifact.status === 'reviewing') ? "border-blue-300 ring-4 ring-blue-50" : "border-gray-200"
                  )}
                >
                  {/* Artifact Header */}
                  <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-2 rounded-lg border",
                        artifact.status === 'complete' ? "bg-emerald-50 border-emerald-100 text-emerald-600" : "bg-white border-gray-200 text-gray-500 shadow-sm"
                      )}>
                        {getIcon(artifact.type)}
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-[#1a1f36]">{artifact.title}</h3>
                        <p className="text-xs text-gray-500 capitalize">{artifact.type} Artifact</p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      {artifact.type === 'python' && artifact.status === 'complete' && (
                        <button 
                          onClick={() => executePython(artifact.id, artifact.content)}
                          disabled={artifact.isExecuting || isPyodideLoading}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50 text-xs font-medium transition-colors shadow-sm"
                        >
                          {artifact.isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                          Run Analysis
                        </button>
                      )}
                      {artifact.iterations && artifact.iterations > 1 && (
                        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md flex items-center gap-1 uppercase tracking-wider" title="Compliance Correction Triggered">
                          <ShieldAlert className="w-3 h-3" />
                          Revised (v{artifact.iterations})
                        </span>
                      )}
                      {artifact.status === 'generating' && (
                        <span className="flex items-center gap-2 text-xs font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating
                        </span>
                      )}
                      {artifact.status === 'reviewing' && (
                        <span className="flex items-center gap-2 text-xs font-medium text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100 animate-pulse">
                          <ShieldAlert className="w-3.5 h-3.5" /> Compliance Check
                        </span>
                      )}
                      {artifact.status === 'complete' && (
                        <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Verified
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Artifact Content */}
                  <div className="p-5 flex-1 overflow-y-auto max-h-[500px] bg-white flex flex-col">
                    {artifact.status === 'pending' && (
                      <div className="h-32 flex items-center justify-center text-gray-400 text-sm font-medium">
                        Task queued for execution...
                      </div>
                    )}
                    
                    {artifact.status === 'generating' && (
                      <div className="h-48 flex flex-col items-center justify-center text-blue-500 space-y-4">
                        <Loader2 className="w-8 h-8 animate-spin" />
                        <span className="text-sm font-medium">Processing data...</span>
                      </div>
                    )}

                    {artifact.status === 'reviewing' && (
                      <div className="h-48 flex flex-col items-center justify-center text-indigo-500 space-y-4">
                        <ShieldAlert className="w-8 h-8 animate-pulse" />
                        <span className="text-sm font-medium">Running compliance and security checks...</span>
                      </div>
                    )}

                    {artifact.status === 'complete' && artifact.type === 'image' && (
                      <img src={artifact.content || undefined} alt={artifact.title} className="w-full h-auto rounded-xl border border-gray-200 shadow-sm object-cover" />
                    )}

                    {artifact.status === 'complete' && artifact.type === 'python' && (
                      <div className="flex flex-col h-full gap-4">
                        <div className="relative group">
                          <div className="absolute top-0 right-0 px-3 py-1.5 bg-gray-800 text-gray-300 text-[10px] font-mono rounded-bl-lg rounded-tr-lg border-b border-l border-gray-700">python</div>
                          <pre className="bg-[#1a1f36] border border-gray-800 rounded-xl p-4 overflow-x-auto text-sm font-mono text-blue-300 m-0 shadow-inner">
                            <code>{artifact.content}</code>
                          </pre>
                        </div>
                        {artifact.executionResult && (
                          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 shadow-sm">
                            <div className="text-[11px] font-semibold text-gray-500 mb-3 uppercase tracking-wider flex items-center gap-2">
                              <Terminal className="w-3.5 h-3.5" /> Execution Output
                            </div>
                            <pre className="text-sm font-mono text-gray-800 whitespace-pre-wrap m-0">
                              {artifact.executionResult}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {artifact.status === 'complete' && artifact.type !== 'image' && artifact.type !== 'python' && (
                      <div className="prose prose-sm max-w-none prose-blue
                        prose-headings:text-[#1a1f36] prose-headings:font-semibold
                        prose-p:text-gray-600 prose-a:text-blue-600
                        prose-pre:bg-[#1a1f36] prose-pre:border prose-pre:border-gray-800 prose-pre:shadow-inner
                        prose-code:text-blue-600 prose-code:bg-blue-50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:before:content-none prose-code:after:content-none">
                        <Markdown>{artifact.content}</Markdown>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {artifacts.length === 0 && !isGenerating && (
              <div className="flex flex-col items-center justify-center py-32 text-gray-400 border-2 border-gray-200 border-dashed rounded-2xl bg-gray-50/50">
                <div className="w-16 h-16 bg-white rounded-2xl border border-gray-200 flex items-center justify-center shadow-sm mb-4">
                  <Activity className="w-8 h-8 text-gray-300" />
                </div>
                <p className="font-semibold text-[#1a1f36] text-lg">No Active Workflows</p>
                <p className="text-sm mt-1 max-w-md text-center">Describe a task above to generate a secure, automated workflow.</p>
              </div>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
