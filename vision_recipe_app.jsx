import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Camera, Upload, Play, Pause, Volume2, VolumeX, RefreshCcw } from "lucide-react";

/**
 * VisionRecipeDemo
 *
 * Fixes "NotAllowedError: Permission denied" by:
 *  - Requesting camera access only after a user gesture (Start Camera button)
 *  - Catching getUserMedia errors and falling back to Upload/Demo mode
 *  - Guarding Web Speech API calls behind feature checks and a toggle
 *
 * Demo includes:
 *  - Live scanning mode (captures a frame every ~1.5s and updates UI)
 *  - Streaming/animated updates for name, recipe, nutrition, tips
 *  - Built-in test panel for core logic (no external runner required)
 *
 * NOTE: This is a sandbox-friendly demo. For a real app, replace
 * `mockAnalyzeImage` with a call to your Vision model and (optionally)
 * use a server function to proxy OpenAI API calls.
 */

export default function VisionRecipeDemo() {
  // Camera & capture
  const videoRef = useRef(null as HTMLVideoElement | null);
  const canvasRef = useRef(null as HTMLCanvasElement | null);
  const [hasStream, setHasStream] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [liveScan, setLiveScan] = useState(false);
  const liveScanTimer = useRef<number | null>(null);

  // Voice
  const [voiceOn, setVoiceOn] = useState(true);

  // Analysis state
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [ingredient, setIngredient] = useState<string | null>(null);
  const [recipe, setRecipe] = useState<string | null>(null);
  const [nutrition, setNutrition] = useState<string | null>(null);
  const [tips, setTips] = useState<string | null>(null);

  // Streaming visual effect
  const [streamed, setStreamed] = useState({ name: "", recipe: "", nutrition: "", tips: "" });

  /**
   * Request camera on user gesture.
   */
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API not supported in this browser.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setHasStream(true);
    } catch (err: any) {
      console.warn("getUserMedia failed:", err);
      setCameraError(
        err?.name === "NotAllowedError"
          ? "Camera permission was denied. Use Upload or Demo mode."
          : err?.message || "Unable to access camera."
      );
      setHasStream(false);
    }
  };

  /**
   * Stop camera when unmounting or toggling off live scan.
   */
  useEffect(() => {
    return () => stopCamera();
  }, []);

  const stopCamera = () => {
    const mediaStream = videoRef.current?.srcObject as MediaStream | null;
    mediaStream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setHasStream(false);
  };

  /**
   * Capture a single frame to a dataURL.
   */
  const captureFrame = () => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const { videoWidth: w, videoHeight: h } = video;
    if (!w || !h) return null;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.8);
  };

  /**
   * MAIN: Scan once (from camera frame or uploaded image)
   */
  const scanOnce = async (source?: string | null) => {
    setScanning(true);
    try {
      const dataUrl = source ?? captureFrame();
      if (!dataUrl) throw new Error("No image to analyze.");
      setPhotoDataUrl(dataUrl);

      // Replace this with real Vision API call in production:
      // const result = await analyzeWithOpenAI(dataUrl)
      const result = await mockAnalyzeImage(dataUrl);

      // Update state and stream text for animation
      const info = generateRecipeData(result.name);
      setIngredient(info.name);
      setRecipe(info.recipe);
      setNutrition(info.nutrition);
      setTips(info.tips);
      streamText(info);

      if (voiceOn) speak(`This looks like ${info.name}. ${stripSsml(info.recipe)}`);
    } catch (err) {
      console.error(err);
    } finally {
      setScanning(false);
    }
  };

  /**
   * Live scan (poll every ~1.5s). If camera blocked, we do nothing.
   */
  useEffect(() => {
    if (!liveScan) {
      if (liveScanTimer.current) window.clearInterval(liveScanTimer.current);
      liveScanTimer.current = null;
      return;
    }
    // Start interval
    liveScanTimer.current = window.setInterval(() => {
      // Capture and analyze without disrupting current UI if nothing new
      const frame = captureFrame();
      if (!frame) return;
      scanOnce(frame);
    }, 1500) as unknown as number;

    return () => {
      if (liveScanTimer.current) window.clearInterval(liveScanTimer.current);
      liveScanTimer.current = null;
    };
  }, [liveScan]);

  /**
   * Upload fallback
   */
  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => scanOnce(String(reader.result));
    reader.readAsDataURL(file);
  };

  /**
   * Demo mode (no camera) — pick one of a few canned items
   */
  const demoItems = ["Mango", "Broccoli", "Eggplant", "Tomato", "Banana"] as const;
  const runDemo = async () => {
    const pick = demoItems[Math.floor(Math.random() * demoItems.length)];
    const info = generateRecipeData(pick);
    setIngredient(info.name);
    setRecipe(info.recipe);
    setNutrition(info.nutrition);
    setTips(info.tips);
    streamText(info);
    if (voiceOn) speak(`This is ${info.name}. ${stripSsml(info.recipe)}`);
  };

  /**
   * Streaming typewriter effect for all fields
   */
  const streamText = (info: { name: string; recipe: string; nutrition: string; tips: string }) => {
    setStreamed({ name: "", recipe: "", nutrition: "", tips: "" });
    const speeds = { name: 12, recipe: 8, nutrition: 10, tips: 10 };

    const type = (key: keyof typeof info, text: string, i = 0) => {
      setStreamed((s) => ({ ...s, [key]: text.slice(0, i) }));
      if (i <= text.length) {
        window.setTimeout(() => type(key, text, i + 1), speeds[key]);
      }
    };

    type("name", info.name);
    type("recipe", info.recipe);
    type("nutrition", info.nutrition);
    type("tips", info.tips);
  };

  /**
   * Speech (browser TTS); guarded for sandbox
   */
  const speak = (utteranceText: string) => {
    try {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const u = new SpeechSynthesisUtterance(utteranceText);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {}
  };

  // ------------------------------
  // Mock Vision + simple knowledge
  // ------------------------------

  /**
   * mockAnalyzeImage: pretend to classify from pixels. In reality, we just
   * hash the dataURL to pick a stable pseudo-class.
   */
  async function mockAnalyzeImage(dataUrl: string): Promise<{ name: string }> {
    // Cheap, deterministic hash -> index
    let h = 0;
    for (let i = 0; i < dataUrl.length; i++) h = (h * 31 + dataUrl.charCodeAt(i)) >>> 0;
    const classes = ["Mango", "Broccoli", "Eggplant", "Tomato", "Banana"];
    const name = classes[h % classes.length];
    await wait(350); // feel like a network call
    return { name };
  }

  function generateRecipeData(rawName: string) {
    const name = titleCase(rawName);
    const db: Record<string, { recipe: string; nutrition: string; tips: string }> = {
      Mango: {
        recipe: "Mango Smoothie: Blend mango, yogurt, and honey.",
        nutrition: "High in Vitamin C & A; provides fiber and antioxidants.",
        tips: "Use ripe mangoes; chill fruit for thicker smoothies.",
      },
      Broccoli: {
        recipe: "Roasted Broccoli: Toss florets with oil, salt, pepper; roast 12–15 min at 220°C.",
        nutrition: "Rich in Vitamin C, K, and folate; contains sulforaphane.",
        tips: "Don’t overcook; keep some crunch to preserve nutrients.",
      },
      Eggplant: {
        recipe: "Quick Mapo Eggplant: Sauté eggplant, add garlic, chili bean paste, soy; simmer till tender.",
        nutrition: "Good source of fiber and polyphenols; low in calories.",
        tips: "Salt slices 10 min to reduce bitterness and improve texture.",
      },
      Tomato: {
        recipe: "Tomato Bruschetta: Dice tomatoes, basil, garlic; toss with olive oil; spoon over toasted bread.",
        nutrition: "Lycopene supports heart health; adds Vitamin C and potassium.",
        tips: "Ripe, in-season tomatoes taste best; don’t refrigerate before slicing.",
      },
      Banana: {
        recipe: "Peanut Butter Banana Toast: Mash banana, spread on toast, drizzle peanut butter.",
        nutrition: "Potassium for muscle function; Vitamin B6; quick carbs for energy.",
        tips: "Overripe bananas sweeten smoothies & bakes naturally.",
      },
    };
    const fallback = {
      recipe: `Simple prep: wash, slice, and enjoy fresh.`,
      nutrition: `Whole produce provides fiber, vitamins, and hydration.`,
      tips: `Pair with citrus, herbs, or a pinch of salt to brighten flavor.`,
    };

    return { name, ...(db[name] ?? fallback) };
  }

  // Utilities
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const titleCase = (s: string) => s.replace(/\w\S*/g, (t) => t[0].toUpperCase() + t.slice(1).toLowerCase());
  const stripSsml = (s: string) => s.replace(/<[^>]+>/g, "");

  // ------------------------------
  // Minimal test panel (ALWAYS ADD TESTS)
  // ------------------------------

  type Test = { name: string; run: () => void };
  const [testsOutput, setTestsOutput] = useState<string[]>([]);

  const tests: Test[] = [
    {
      name: "titleCase formats correctly",
      run: () => {
        const out = titleCase("mANgo");
        if (out !== "Mango") throw new Error(`Expected Mango, got ${out}`);
      },
    },
    {
      name: "generateRecipeData returns known data (Mango)",
      run: () => {
        const d = generateRecipeData("Mango");
        if (!/Smoothie/.test(d.recipe)) throw new Error("Recipe should mention Smoothie for Mango");
        if (!/Vitamin C/.test(d.nutrition)) throw new Error("Nutrition should mention Vitamin C for Mango");
      },
    },
    {
      name: "generateRecipeData returns fallback for Unknown",
      run: () => {
        const d = generateRecipeData("Mystery");
        if (!/Simple prep/.test(d.recipe)) throw new Error("Should use fallback recipe for unknown item");
      },
    },
  ];

  const runTests = () => {
    const logs: string[] = [];
    tests.forEach((t) => {
      try {
        t.run();
        logs.push(`✅ ${t.name}`);
      } catch (e: any) {
        logs.push(`❌ ${t.name}: ${e.message || e}`);
      }
    });
    setTestsOutput(logs);
  };

  // ------------------------------
  // UI
  // ------------------------------

  return (
    <div className="min-h-screen w-full max-w-md mx-auto p-4 flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Vision + Voice Recipe Demo</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm">Voice</span>
          <Switch checked={voiceOn} onCheckedChange={(v) => setVoiceOn(Boolean(v))} />
          {voiceOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </div>
      </header>

      {/* Camera / Preview */}
      <Card className="overflow-hidden rounded-2xl">
        <CardContent className="p-0">
          <div className="relative aspect-square bg-black/5 flex items-center justify-center">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
            {!hasStream && (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div className="opacity-80">
                  <Camera className="w-10 h-10 mx-auto mb-2" />
                  <p className="text-sm">Camera is inactive. Start it or use Upload/Demo.</p>
                  {cameraError && (
                    <p className="text-xs text-red-600 mt-2">{cameraError}</p>
                  )}
                </div>
              </div>
            )}
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={startCamera} variant="secondary"><Camera className="w-4 h-4 mr-2" />Start Camera</Button>
        <Button disabled={!hasStream || scanning} onClick={() => scanOnce()}>
          {scanning ? <RefreshCcw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}Scan Once
        </Button>
        <label className="col-span-1">
          <Input type="file" accept="image/*" capture="environment" onChange={onUpload} className="cursor-pointer" />
        </label>
        <Button variant="outline" onClick={runDemo}><Upload className="w-4 h-4 mr-2" />Demo Item</Button>
        <div className="col-span-2 flex items-center justify-between p-2 border rounded-xl">
          <div className="flex items-center gap-2">
            <Switch checked={liveScan} onCheckedChange={(v) => setLiveScan(Boolean(v))} />
            <span className="text-sm">Live Scan</span>
          </div>
          <div className="text-xs opacity-70">Captures a frame every 1.5s</div>
        </div>
      </div>

      {/* Analysis Panel */}
      <AnimatePresence>
        {(ingredient || streamed.name) && (
          <motion.div
            key={ingredient || "panel"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-2xl bg-white shadow p-4 space-y-3"
          >
            <motion.h2
              className="text-lg font-bold"
              animate={{ y: [0, -4, 0] }}
              transition={{ repeat: Infinity, duration: 2 }}
            >
              {streamed.name || ingredient}
            </motion.h2>

            <motion.div layout className="space-y-2">
              <Field label="Recipe Idea" text={streamed.recipe || recipe || ""} />
              <Field label="Nutritional Benefits" text={streamed.nutrition || nutrition || ""} />
              <Field label="Cooking Tips" text={streamed.tips || tips || ""} />
            </motion.div>

            {photoDataUrl && (
              <div className="pt-2">
                <img src={photoDataUrl} alt="last capture" className="w-full h-32 object-cover rounded-xl" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Test Panel */}
      <Card className="mt-2">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Test Panel</h3>
            <Button size="sm" variant="outline" onClick={runTests}>Run Tests</Button>
          </div>
          <ul className="text-xs space-y-1">
            {testsOutput.length === 0 && <li className="opacity-60">No tests run yet.</li>}
            {testsOutput.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Integration Notes */}
      <details className="text-xs opacity-80">
        <summary className="cursor-pointer">How to hook up ChatGPT Vision + Voice</summary>
        <ol className="list-decimal pl-4 space-y-1 mt-2">
          <li>Ensure your app is served over HTTPS and request camera access on a user gesture.</li>
          <li>Replace <code>mockAnalyzeImage</code> with an API call that sends the image (base64 or Blob) to your Vision endpoint (e.g., OpenAI Responses API with an <code>input_image</code> item).</li>
          <li>Use model output to update <code>ingredient</code>, <code>recipe</code>, <code>nutrition</code>, and <code>tips</code>. You can stream partial tokens to feed <code>streamText</code> for live updates.</li>
          <li>For voice, either keep <code>SpeechSynthesisUtterance</code> (client) or call TTS to get audio and play it in an <code>&lt;audio&gt;</code> element.</li>
        </ol>
      </details>
    </div>
  );
}

function Field({ label, text }: { label: string; text: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-3 rounded-xl bg-gray-50"
    >
      <div className="text-xs uppercase tracking-wide opacity-70 mb-1">{label}</div>
      <div className="text-sm leading-relaxed">{text || "—"}</div>
    </motion.div>
  );
}
