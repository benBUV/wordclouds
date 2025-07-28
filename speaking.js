const globalQuestions = [];

const Speaking = (function () {
  const state = {
    questions: [],
    index: 0,
    countdownInterval: null,
    mediaChunks: [],
    isRecording: false,
    transcripts: [],
    timeLeft: 0,
    isProcessing: false,
  };

  const DOM = {
    prompt: document.getElementById("prompt"),
    talkBtn: document.getElementById("talkBtn"),
    countdownBar: document.getElementById("countdownBar"),
    countdownStatus: document.getElementById("countdownStatus"),
    transcript: document.getElementById("transcriptContainer"),
    examinerImg: document.getElementById("examinerImg"),
    progressBar: document.getElementById("progressBar"),
    pauseBtn: document.getElementById("pauseBtn"),
    cancelBtn: document.getElementById("cancelBtn"),
    examinerBox: document.getElementById("examinerBox"),
    audioLevel: document.getElementById("audioLevel"),
  };

  const query = new URLSearchParams(window.location.search);
  const config = {
    scriptUrl: query.get("scriptUrl"),
    sheetName: query.get("sheet") || "",
    questionCount: parseInt(query.get("questions")) || 3,
    countdownTime: parseInt(query.get("max")) || 60,
    audioType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/mp4",
    downloadName: "ielts-response.webm",
    examinerImage: "https://via.placeholder.com/80?text=Examiner",
  };

  let recognition, mediaRecorder, audioContext, analyser, microphone;
  const blobUrls = [];

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  const resizeIframe = debounce(function () {
    const height = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) + 20;
    const cappedHeight = Math.min(height, 1000);
    if (height > 1000) {
      console.warn(`Excessive scrollHeight: ${height}px, using cappedHeight: ${cappedHeight}px`);
    }
    console.log(`Sending lti.frameResize with height: ${cappedHeight}px`);
    window.parent.postMessage(
      JSON.stringify({ subject: "lti.frameResize", height: `${cappedHeight}px` }),
      "*"
    );
  }, 100);

  function cleanupMedia() {
    if (mediaRecorder && mediaRecorder.stream) {
      mediaRecorder.stream.getTracks().forEach(track => {
        track.stop();
        console.log("Stopped media track:", track.label);
      });
    }
    if (audioContext) {
      audioContext.close().catch(err => console.warn("Failed to close AudioContext:", err.message));
      console.log("AudioContext closed");
    }
    mediaRecorder = null;
    audioContext = null;
    analyser = null;
    microphone = null;
    console.log("Media resources cleaned up");
  }

  function cleanupRecognition() {
    if (recognition) {
      try {
        recognition.stop();
        recognition.onresult = null;
        recognition.onend = null;
        console.log("SpeechRecognition stopped and handlers cleared");
      } catch (err) {
        console.warn("SpeechRecognition cleanup failed:", err.message);
      }
      recognition = null;
    }
    console.log("SpeechRecognition resources cleaned up");
  }

  function removeEventListeners() {
    const cloneTalkBtn = DOM.talkBtn.cloneNode(true);
    DOM.talkBtn.parentNode.replaceChild(cloneTalkBtn, DOM.talkBtn);
    DOM.talkBtn = cloneTalkBtn;

    const clonePauseBtn = DOM.pauseBtn.cloneNode(true);
    DOM.pauseBtn.parentNode.replaceChild(clonePauseBtn, DOM.pauseBtn);
    DOM.pauseBtn = clonePauseBtn;

    const cloneCancelBtn = DOM.cancelBtn.cloneNode(true);
    DOM.cancelBtn.parentNode.replaceChild(cloneCancelBtn, DOM.cancelBtn);
    DOM.cancelBtn = cloneCancelBtn;

    console.log("Event listeners removed from buttons");
  }

  async function initApp() {
    const requiredElements = [
      { id: "prompt", element: DOM.prompt },
      { id: "talkBtn", element: DOM.talkBtn },
      { id: "countdownBar", element: DOM.countdownBar },
      { id: "countdownStatus", element: DOM.countdownStatus },
      { id: "transcriptContainer", element: DOM.transcript },
      { id: "examinerImg", element: DOM.examinerImg },
      { id: "progressBar", element: DOM.progressBar },
      { id: "pauseBtn", element: DOM.pauseBtn },
      { id: "cancelBtn", element: DOM.cancelBtn },
      { id: "examinerBox", element: DOM.examinerBox },
      { id: "audioLevel", element: DOM.audioLevel },
    ];
    for (const { id, element } of requiredElements) {
      if (!element) {
        console.error(`DOM element #${id} not found. Ensure <${element?.tagName || "element"} id="${id}"> exists.`);
        handleError(`Missing DOM element: #${id}`);
        return;
      }
    }
    preloadProgressBar();
    DOM.talkBtn.disabled = true;
    DOM.pauseBtn.disabled = true;
    DOM.talkBtn.setAttribute("aria-label", "Start recording");
    DOM.pauseBtn.setAttribute("aria-label", "Pause recording");
    try {
      if (DOM.examinerImg) {
        DOM.examinerImg.innerHTML = `<img src="${config.examinerImage}" alt="Examiner placeholder" style="width: 80px; height: 80px;">`;
        DOM.examinerImg.setAttribute("aria-label", "Examiner image");
        console.log("Static examiner image set");
      } else {
        throw new Error("Examiner image element not found");
      }
    } catch (err) {
      console.error("Failed to set examiner image:", err.message);
      handleError("Failed to load examiner image.");
    }
    await loadQuestions();
    if (!state.questions.length) {
      handleError("No valid questions loaded.");
      return;
    }
    DOM.prompt.textContent = "Click to begin";
    setupSpeechRecognition();
    try {
      await setupMediaRecorder();
    } catch (err) {
      console.error("Microphone access error:", err.message);
      handleError(`Please allow microphone access in Canvas app or browser settings. ${window.matchMedia("(max-width: 600px)").matches ? "On mobile, go to Settings > Canvas > Microphone." : ""}`);
      return;
    }
    setupAudioLevelIndicator();
    setupEventListeners();
    DOM.talkBtn.disabled = false;
    resizeIframe();
  }

  function preloadProgressBar() {
    DOM.progressBar.innerHTML = "";
    DOM.progressBar.setAttribute("aria-valuemax", config.questionCount);
    for (let i = 0; i < config.questionCount; i++) {
      const step = document.createElement("span");
      step.className = "step";
      step.textContent = `Q${i + 1}`;
      step.setAttribute("aria-label", `Question ${i + 1}`);
      DOM.progressBar.appendChild(step);
    }
    updateProgressBar();
  }

  function updateProgressBar() {
    const steps = DOM.progressBar.querySelectorAll(".step");
    steps.forEach((el, i) => {
      el.classList.toggle("active", i === state.index);
      el.classList.toggle("completed", i < state.index);
    });
    DOM.progressBar.setAttribute("aria-valuenow", state.index + 1);
  }

  async function loadQuestions() {
    if (globalQuestions.length > 0) {
      console.log("Using cached questions from globalQuestions:", globalQuestions);
      state.questions = globalQuestions.slice(0, config.questionCount);
      state.mediaChunks = Array(state.questions.length).fill().map(() => []);
      return;
    }
    if (!config.scriptUrl) {
      handleError("Missing scriptUrl.");
      return;
    }
    try {
      const url = `${config.scriptUrl}?sheet=${encodeURIComponent(config.sheetName)}`;
      console.log("Fetching questions from:", url);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error! Status: ${res.status}`);
      const data = await res.json();
      if (data.result === "success" && Array.isArray(data.list)) {
        globalQuestions.push(...data.list.map(item => item.question).filter(Boolean));
        state.questions = globalQuestions.slice(0, config.questionCount);
        state.mediaChunks = Array(state.questions.length).fill().map(() => []);
        console.log("Questions loaded and cached:", globalQuestions);
      } else {
        handleError("Invalid sheet format.");
      }
    } catch (err) {
      handleError(`Unable to load questions: ${err.message}`);
    }
  }

  function setupSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      handleError("Speech Recognition not supported in this browser. Please use a compatible browser like Chrome.");
      return;
    }
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + " ";
        } else {
          interim += transcript + " ";
        }
      }
      DOM.transcript.textContent = interim || final || "Speak now...";
      state.transcripts[state.index] = (state.transcripts[state.index] || "") + final.trim() + " ";
      console.log(`Transcript for question ${state.index + 1}:`, state.transcripts[state.index]);
    };

    recognition.onend = () => {
      console.log("Speech recognition ended for question", state.index + 1);
    };

    recognition.onerror = (event) => {
      console.error("SpeechRecognition error:", event.error);
      if (event.error === "no-speech" || event.error === "not-allowed") {
        handleError("Microphone access denied or no speech detected. Please check permissions.");
      }
    };
  }

  async function setupMediaRecorder() {
    if (!window.MediaRecorder) {
      handleError("MediaRecorder not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: config.audioType,
        audioBitsPerSecond: window.matchMedia("(max-width: 600px)").matches ? 64000 : 128000,
      });
      mediaRecorder.ondataavailable = e => {
        if (!state.mediaChunks[state.index]) state.mediaChunks[state.index] = [];
        if (e.data.size > 0 && e.data instanceof Blob) {
          state.mediaChunks[state.index].push(e.data);
          console.log(`Data pushed to mediaChunks[${state.index}]: size=${e.data.size}, type=${e.data.type}`);
        } else {
          console.warn(`Invalid or empty chunk for question ${state.index + 1}: size=${e.data.size}`);
        }
      };
      mediaRecorder.onstop = () => {
        console.log("MediaRecorder stopped for question", state.index + 1);
        console.log(`Total chunks for question ${state.index + 1}:`, state.mediaChunks[state.index]?.length || 0);
      };
    } catch (err) {
      throw err;
    }
  }

  function setupAudioLevelIndicator() {
    if (!mediaRecorder || !DOM.audioLevel) {
      console.error("MediaRecorder or #audioLevel canvas not available, skipping audio level indicator");
      return;
    }
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    microphone = audioContext.createMediaStreamSource(mediaRecorder.stream);
    microphone.connect(analyser);
    analyser.fftSize = 256;
    const ctx = DOM.audioLevel.getContext("2d");
    function drawLevel() {
      if (!state.isRecording) return;
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length;
      ctx.clearRect(0, 0, DOM.audioLevel.width, DOM.audioLevel.height);
      ctx.fillStyle = average > 50 ? "#4caf50" : "#ff4d4d";
      ctx.fillRect(0, 0, (average / 255) * DOM.audioLevel.width, DOM.audioLevel.height);
      requestAnimationFrame(drawLevel);
    }
    mediaRecorder.onstart = () => drawLevel();
  }

  function setupEventListeners() {
    removeEventListeners();
    DOM.talkBtn.addEventListener("click", handleTalkClick);
    DOM.talkBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        handleTalkClick();
      }
    });
    DOM.pauseBtn.addEventListener("click", () => {
      if (!DOM.pauseBtn.disabled) pauseSession();
    });
    DOM.pauseBtn.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !DOM.pauseBtn.disabled) {
        pauseSession();
      }
    });
    DOM.cancelBtn.addEventListener("click", cancelSession);
    DOM.cancelBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") cancelSession();
    });
    console.log("Event listeners set up");
  }

  async function handleTalkClick() {
    if (state.isProcessing) {
      console.log("Click ignored: Processing in progress");
      return;
    }
    if (DOM.talkBtn.classList.contains("try-again")) {
      state.isProcessing = true;
      DOM.talkBtn.disabled = true;
      DOM.pauseBtn.disabled = true;
      DOM.prompt.textContent = "Click to begin";
      try {
        cleanupMedia();
        cleanupRecognition();
        state.mediaChunks = Array(state.questions.length).fill().map(() => []);
        state.transcripts = [];
        state.index = 0;
        state.isRecording = false;
        state.timeLeft = 0;
        state.countdownInterval = null;
        state.questions = globalQuestions.slice(0, config.questionCount);
        console.log("Retrying session with cached questions:", state.questions);
        DOM.talkBtn.textContent = "Start";
        DOM.talkBtn.classList.remove("try-again", "recording");
        DOM.talkBtn.setAttribute("aria-label", "Start recording");
        DOM.transcript.style.display = "none";
        updateProgressBar();
        setupSpeechRecognition();
        await setupMediaRecorder();
        setupAudioLevelIndicator();
        setupEventListeners();
        DOM.talkBtn.disabled = false;
        state.isProcessing = false;
      } catch (err) {
        console.error("Error during try-again:", err.message);
        handleError("Failed to restart session. Please try again.");
        state.isProcessing = false;
        DOM.talkBtn.disabled = false;
      }
      return;
    }
    if (DOM.talkBtn.classList.contains("retry")) {
      state.questions = globalQuestions.slice(0, config.questionCount);
      state.mediaChunks = Array(state.questions.length).fill().map(() => []);
      console.log("Retrying initialization with cached questions:", state.questions);
      DOM.pauseBtn.disabled = true;
      await initApp();
      return;
    }

    state.isProcessing = true;
    DOM.talkBtn.disabled = true;

    try {
      if (!state.isRecording) {
        if (mediaRecorder.state === "inactive") {
          mediaRecorder.start(500);
          console.log("MediaRecorder started for question", state.index + 1);
        } else {
          console.warn(`MediaRecorder not in inactive state: ${mediaRecorder.state}`);
        }
        try {
          recognition.start();
          console.log("SpeechRecognition started for question", state.index + 1);
        } catch (err) {
          console.warn(`SpeechRecognition start failed: ${err.message}`);
        }
        state.isRecording = true;
        DOM.talkBtn.textContent = state.index === state.questions.length - 1 ? "Finish" : "Next question";
        DOM.talkBtn.classList.add("recording");
        DOM.talkBtn.setAttribute("aria-label", state.index === state.questions.length - 1 ? "Finish session" : "Go to next question");
        DOM.pauseBtn.disabled = false;
        DOM.pauseBtn.textContent = "Pause";
        DOM.pauseBtn.setAttribute("aria-label", "Pause recording");
        showQuestion();
        DOM.talkBtn.disabled = false;
        state.isProcessing = false;
      } else {
        const stopRecognition = new Promise(resolve => {
          recognition.onend = () => {
            console.log("Recognition stopped for question", state.index + 1);
            recognition.onend = null;
            resolve();
          };
          try {
            recognition.stop();
          } catch (err) {
            console.warn(`SpeechRecognition stop failed: ${err.message}`);
            resolve();
          }
        });

        const stopMediaRecorder = new Promise(resolve => {
          if (mediaRecorder.state === "recording" || mediaRecorder.state === "paused") {
            mediaRecorder.onstop = () => {
              console.log("MediaRecorder stopped for question", state.index + 1);
              mediaRecorder.onstop = null;
              resolve();
            };
            mediaRecorder.stop();
          } else {
            console.warn(`MediaRecorder not in recording/paused state: ${mediaRecorder.state}`);
            resolve();
          }
        });

        await Promise.all([
          stopRecognition.then(() => console.log("Recognition stop completed")),
          stopMediaRecorder.then(() => console.log("MediaRecorder stop completed")),
        ]);

        console.log(`Chunks collected for question ${state.index + 1}:`, state.mediaChunks[state.index]?.length || 0);

        state.isRecording = false;
        DOM.pauseBtn.disabled = true;
        DOM.pauseBtn.textContent = "Pause";
        DOM.pauseBtn.setAttribute("aria-label", "Pause recording");

        state.index++;
        if (state.index < state.questions.length) {
          if (mediaRecorder.state === "inactive") {
            mediaRecorder.start(500);
            console.log("MediaRecorder started for question", state.index + 1);
          } else {
            console.warn(`MediaRecorder not in inactive state for next question: ${mediaRecorder.state}`);
          }
          try {
            recognition.start();
            console.log("SpeechRecognition started for question", state.index + 1);
          } catch (err) {
            console.warn(`SpeechRecognition start failed: ${err.message}`);
          }
          state.isRecording = true;
          DOM.talkBtn.textContent = state.index === state.questions.length - 1 ? "Finish" : "Next question";
          DOM.talkBtn.setAttribute("aria-label", state.index === state.questions.length - 1 ? "Finish session" : "Go to next question");
          DOM.pauseBtn.disabled = false;
          DOM.pauseBtn.textContent = "Pause";
          DOM.pauseBtn.setAttribute("aria-label", "Pause recording");
          showQuestion();
          DOM.talkBtn.disabled = false;
          state.isProcessing = false;
        } else {
          endSession();
          DOM.talkBtn.disabled = false;
          state.isProcessing = false;
        }
      }
    } catch (err) {
      console.error("Error in handleTalkClick:", err.message);
      handleError(`Error occurred. Please check microphone or browser compatibility. ${window.matchMedia("(max-width: 600px)").matches ? "On mobile, go to Settings > Canvas > Microphone." : ""}`);
      state.isProcessing = false;
      DOM.talkBtn.disabled = false;
      DOM.pauseBtn.disabled = true;
    }
  }

  function pauseSession() {
    if (!state.isRecording) {
      mediaRecorder.resume();
      try {
        recognition.start();
      } catch (err) {
        console.warn(`SpeechRecognition resume failed: ${err.message}`);
      }
      startCountdown();
      DOM.prompt.textContent = state.questions[state.index];
      DOM.pauseBtn.textContent = "Pause";
      DOM.pauseBtn.setAttribute("aria-label", "Pause recording");
      state.isRecording = true;
      DOM.pauseBtn.disabled = false;
      DOM.talkBtn.disabled = false;
      DOM.talkBtn.setAttribute("aria-label", state.index === state.questions.length - 1 ? "Finish session" : "Go to next question");
      const existingMsg = document.getElementById("disabledMsg");
      if (existingMsg) existingMsg.remove();
    } else {
      mediaRecorder.pause();
      try {
        recognition.stop();
      } catch (err) {
        console.warn(`SpeechRecognition pause failed: ${err.message}`);
      }
      clearInterval(state.countdownInterval);
      DOM.pauseBtn.textContent = "Resume";
      DOM.prompt.textContent = "Paused";
      DOM.pauseBtn.setAttribute("aria-label", "Resume recording");
      state.isRecording = false;
      DOM.pauseBtn.disabled = false;
      DOM.talkBtn.disabled = true;
      DOM.talkBtn.setAttribute("aria-label", "Next question disabled while paused");
      const disabledMsg = document.createElement("div");
      disabledMsg.id = "disabledMsg";
      disabledMsg.textContent = "Resume or cancel to proceed";
      disabledMsg.style.cssText = "font-size: 12px; color: #6b7280; text-align: center; margin-top: 4px;";
      DOM.talkBtn.parentNode.appendChild(disabledMsg);
      if (!state.mediaChunks[state.index]) state.mediaChunks[state.index] = [];
    }
    resizeIframe();
  }

  function cancelSession() {
    if (confirm("Cancel the session? Your current responses will be lost.")) {
      try {
        cleanupRecognition();
        cleanupMedia();
        clearInterval(state.countdownInterval);
        state.mediaChunks = Array(state.questions.length).fill().map(() => []);
        state.transcripts = [];
        state.index = 0;
        state.isRecording = false;
        state.timeLeft = 0;
        state.countdownInterval = null;
        state.questions = globalQuestions.slice(0, config.questionCount);
        console.log("Session cancelled, questions reset from globalQuestions:", state.questions);
        DOM.prompt.textContent = "Click to begin";
        DOM.talkBtn.textContent = "Start";
        DOM.talkBtn.classList.remove("try-again", "recording");
        DOM.talkBtn.setAttribute("aria-label", "Start recording");
        DOM.transcript.style.display = "none";
        DOM.pauseBtn.disabled = true;
        DOM.pauseBtn.textContent = "Pause";
        DOM.pauseBtn.setAttribute("aria-label", "Pause recording");
        const existingMsg = document.getElementById("disabledMsg");
        if (existingMsg) existingMsg.remove();
        updateProgressBar();
        setupSpeechRecognition();
        setupMediaRecorder().then(() => {
          setupAudioLevelIndicator();
          setupEventListeners();
        }).catch(err => {
          handleError(`Failed to restart media after cancel: ${err.message}`);
        });
      } catch (err) {
        console.error("Error in cancelSession:", err.message);
        handleError("Failed to cancel session. Please try again.");
        DOM.pauseBtn.disabled = true;
      }
    }
  }

  function showQuestion() {
    if (!state.questions[state.index]) {
      handleError("No question available for this step.");
      return;
    }
    DOM.prompt.classList.add("prompt-exit");
    setTimeout(() => {
      DOM.prompt.classList.remove("prompt-exit");
      updateProgressBar();
      DOM.prompt.textContent = state.questions[state.index];
      DOM.transcript.textContent = state.transcripts[state.index] || "Speak now...";
      DOM.prompt.classList.add("prompt-enter");
      setTimeout(() => {
        DOM.prompt.classList.remove("prompt-enter");
      }, 200);
      if (DOM.countdownBar && DOM.countdownStatus) {
        startCountdown();
      } else {
        console.error("DOM.countdownBar or DOM.countdownStatus not found, skipping countdown");
        handleError("Missing countdown elements, cannot start countdown.");
      }
      resizeIframe();
    }, 200);
  }

  function startCountdown() {
    clearInterval(state.countdownInterval);
    const total = config.countdownTime;
    state.timeLeft = total;
    if (DOM.countdownBar) {
      DOM.countdownBar.style.width = "0%";
      DOM.countdownBar.style.backgroundColor = "#4caf50";
      console.log(`Countdown bar initialized: width=0%, timeLeft=${state.timeLeft}`);
    } else {
      console.error("DOM.countdownBar not found, cannot update countdown bar");
    }
    if (DOM.countdownStatus) {
      DOM.countdownStatus.textContent = `0 seconds elapsed`;
    }
    state.countdownInterval = setInterval(() => {
      state.timeLeft--;
      const timeElapsed = total - state.timeLeft;
      const percent = (timeElapsed / total) * 100;
      if (DOM.countdownBar) {
        DOM.countdownBar.style.width = `${percent}%`;
        DOM.countdownBar.style.backgroundColor =
          timeElapsed >= total - 10 ? "#ff4d4d" : timeElapsed >= total - 30 ? "#ffeb3b" : "#4caf50";
        console.log(`Countdown bar updated: width=${percent}%, timeElapsed=${timeElapsed}`);
      }
      if (DOM.countdownStatus) {
        DOM.countdownStatus.textContent = `${timeElapsed} seconds elapsed`;
      }
      if (state.timeLeft <= 0) {
        clearInterval(state.countdownInterval);
        DOM.prompt.textContent = "Time's up. Click next.";
        if (DOM.countdownStatus) {
          DOM.countdownStatus.textContent = "Time's up";
        }
        console.log("Countdown ended");
      }
    }, 1000);
  }

  function endSession() {
    clearInterval(state.countdownInterval);
    cleanupRecognition();
    cleanupMedia();
    DOM.prompt.textContent = "Well done!";
    DOM.talkBtn.textContent = "Try again?";
    DOM.talkBtn.classList.remove("recording");
    DOM.talkBtn.classList.add("try-again");
    DOM.talkBtn.setAttribute("aria-label", "Restart session");
    DOM.transcript.style.display = "block";
    DOM.pauseBtn.disabled = true;
    DOM.pauseBtn.textContent = "Pause";
    DOM.pauseBtn.setAttribute("aria-label", "Pause recording");
    const existingMsg = document.getElementById("disabledMsg");
    if (existingMsg) existingMsg.remove();
    renderTranscriptBlock();
  }

  function renderTranscriptBlock() {
    DOM.transcript.innerHTML = "";
    blobUrls.forEach(url => URL.revokeObjectURL(url));
    blobUrls.length = 0;

    state.questions.forEach((question, i) => {
      const block = document.createElement("div");
      block.className = "transcript-block collapsed";
      const heading = document.createElement("h4");
      heading.textContent = `Question ${i + 1}: ${question}`;
      heading.setAttribute("aria-label", `Toggle question ${i + 1} details`);
      heading.addEventListener("click", () => {
        block.classList.toggle("collapsed");
        resizeIframe();
      });

      const answer = document.createElement("textarea");
      answer.value = (state.transcripts[i] || "").trim();
      answer.setAttribute("aria-label", `Edit answer for question ${i + 1}`);
      answer.addEventListener("input", (e) => {
        state.transcripts[i] = e.target.value;
        resizeIframe();
      });

      const audio = document.createElement("audio");
      audio.controls = true;
      audio.style.cssText = "width: calc(100% - 8px); margin: 4px; display: block;";
      audio.setAttribute("aria-label", `Audio response for question ${i + 1}`);
      if (state.mediaChunks[i] && state.mediaChunks[i].length > 0 && state.mediaChunks[i].every(chunk => chunk instanceof Blob && chunk.size > 0)) {
        const blob = new Blob(state.mediaChunks[i], { type: config.audioType });
        console.log(`Blob size for question ${i + 1}:`, blob.size);
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          audio.src = url;
          blobUrls.push(url);
          console.log(`Audio src set for question ${i + 1}:`, url);
        } else {
          console.warn(`Empty Blob for question ${i + 1}`);
          audio.title = "No audio recorded for this question";
          audio.disabled = true;
        }
      } else {
        console.warn(`Invalid or missing media chunks for question ${i + 1}`);
        audio.title = "No audio recorded for this question";
        audio.disabled = true;
      }
      audio.addEventListener("error", (e) => {
        console.error(`Audio error for question ${i + 1}:`, e);
        audio.title = "Error playing audio for this question";
      });

      block.appendChild(heading);
      block.appendChild(answer);
      block.appendChild(audio);
      DOM.transcript.appendChild(block);
    });

    const label = document.createElement("h4");
    label.textContent = "🔊 Full Speaking Response:";
    DOM.transcript.appendChild(label);

    const fullChunks = state.mediaChunks.filter((chunks, i) => {
      if (chunks && chunks.length > 0 && chunks.every(chunk => chunk instanceof Blob && chunk.size > 0)) {
        console.log(`Valid chunks for question ${i + 1}: count=${chunks.length}, totalSize=${chunks.reduce((sum, chunk) => sum + chunk.size, 0)}`);
        return true;
      }
      console.warn(`Skipping invalid chunks for question ${i + 1}`);
      return false;
    });

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.style.cssText = "width: calc(100% - 8px); margin: 4px; display: block;";
    audio.setAttribute("aria-label", "Full speaking response audio");

    if (fullChunks.length > 0) {
      try {
        const fullBlob = new Blob([].concat(...fullChunks), { type: config.audioType });
        console.log("Full Blob size:", fullBlob.size);
        if (!audio.canPlayType(fullBlob.type)) {
          console.warn(`Browser does not support ${fullBlob.type} for full response`);
          audio.title = `Audio format (${fullBlob.type}) not supported by this browser`;
          audio.disabled = true;
        } else if (fullBlob.size > 0) {
          const url = URL.createObjectURL(fullBlob);
          audio.src = url;
          blobUrls.push(url);
          console.log("Full response audio src:", url);

          const link = document.createElement("a");
          link.href = url;
          link.download = config.downloadName;
          link.textContent = "Download full response";
          link.style.cssText = "display: block; margin: 10px 4px; font-size: 13px;";
          link.setAttribute("aria-label", "Download full response audio");
          DOM.transcript.appendChild(link);
        } else {
          console.warn("Empty full response Blob");
          audio.title = "No valid audio recorded for full response";
          audio.disabled = true;
        }
      } catch (err) {
        console.error("Error creating full response Blob:", err.message);
        audio.title = "Error generating full response audio";
        audio.disabled = true;
      }
    } else {
      console.warn("No valid chunks for full response");
      audio.title = "No valid audio recorded for full response";
      audio.disabled = true;
      const errorMsg = document.createElement("p");
      errorMsg.className = "error";
      errorMsg.textContent = "No valid audio recorded for the full response. Please record all questions.";
      DOM.transcript.appendChild(errorMsg);
    }
    audio.addEventListener("error", (e) => {
      console.error("Full response audio error:", e);
      audio.title = "Error playing full response audio";
    });
    DOM.transcript.appendChild(audio);

    resizeIframe();
  }

  function handleError(msg) {
    console.warn(msg);
    DOM.prompt.textContent = `❌ ${msg} ${window.matchMedia("(max-width: 600px)").matches ? "On mobile, go to Settings > Canvas > Microphone." : "Check browser settings to allow microphone access for this site."}`;
    DOM.talkBtn.disabled = true;
    DOM.talkBtn.textContent = "Retry";
    DOM.talkBtn.classList.add("retry");
    DOM.talkBtn.setAttribute("aria-label", "Retry initialization");
    DOM.pauseBtn.disabled = true;
    DOM.pauseBtn.textContent = "Pause";
    DOM.pauseBtn.setAttribute("aria-label", "Pause recording");
    const existingMsg = document.getElementById("disabledMsg");
    if (existingMsg) existingMsg.remove();
    if (DOM.examinerImg) {
      DOM.examinerImg.innerHTML = `<img src="${config.examinerImage}" alt="Examiner placeholder" style="width: 80px; height: 80px;">`;
      DOM.examinerImg.setAttribute("aria-label", "Examiner image");
    }
    resizeIframe();
  }

  return { initApp };
})();

Speaking.initApp();
