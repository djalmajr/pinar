(() => {
  const MAX_VOICE_SECONDS = 120;

  function formatVoiceComment(result, acceptanceLabel) {
    const comment = typeof result?.comment === "string" ? result.comment.trim() : "";
    const criteria = Array.isArray(result?.acceptanceCriteria)
      ? result.acceptanceCriteria.filter((item) => typeof item === "string" && item.trim()).slice(0, 8)
      : [];
    return criteria.length
      ? `${comment}\n\n${acceptanceLabel}:\n${criteria.map((item) => `- ${item.trim()}`).join("\n")}`
      : comment;
  }

  function preferredVoiceMimeType(MediaRecorderClass) {
    return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
      .find((type) => MediaRecorderClass?.isTypeSupported?.(type)) || "";
  }

  function boundedVoiceDuration(startedAt, now) {
    return Math.max(1, Math.min(MAX_VOICE_SECONDS, Math.ceil((now - startedAt) / 1000)));
  }

  function voiceSignalLevel(samples) {
    if (!samples?.length) return 0;
    let energy = 0;
    for (const sample of samples) {
      const centered = (Number(sample) - 128) / 128;
      energy += centered * centered;
    }
    const rms = Math.sqrt(energy / samples.length);
    // Ignore the low ambient floor, then map ordinary speech onto 0..1.
    return Math.max(0, Math.min(1, (rms - 0.02) / 0.18));
  }

  function voiceWaveHeights(level, phase = 0) {
    const strength = Math.max(0, Math.min(1, Number(level) || 0));
    const shape = [0.48, 0.78, 1, 0.72, 0.44];
    return shape.map((weight, index) => {
      const movement = 0.76 + 0.24 * Math.sin(phase + index * 1.35);
      return Math.round((3 + 12 * strength * weight * movement) * 10) / 10;
    });
  }

  globalThis.__pinarVoice = {
    MAX_VOICE_SECONDS,
    boundedVoiceDuration,
    formatVoiceComment,
    preferredVoiceMimeType,
    voiceSignalLevel,
    voiceWaveHeights,
  };
})();
