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

  function appendVoiceWaveLevel(history, level, maxSamples = 64) {
    const limit = Math.max(1, Math.trunc(maxSamples) || 1);
    const sample = Math.max(0, Math.min(1, Number(level) || 0));
    const previous = Array.isArray(history) ? history : [];
    return [...previous.slice(-(limit - 1)), sample];
  }

  function insertVoiceComment(value, comment, selectionStart, selectionEnd) {
    const current = typeof value === "string" ? value : "";
    const addition = typeof comment === "string" ? comment.trim() : "";
    const hasSelection = Number.isInteger(selectionStart)
      && Number.isInteger(selectionEnd)
      && selectionStart >= 0
      && selectionStart <= selectionEnd
      && selectionEnd <= current.length;
    const start = hasSelection ? selectionStart : current.length;
    const end = hasSelection ? selectionEnd : current.length;
    const before = current.slice(0, start);
    const after = current.slice(end);
    const prefix = before && addition && !/\s$/.test(before) && !/^\s/.test(addition) ? " " : "";
    const suffix = after && addition && !/^\s/.test(after) && !/\s$/.test(addition) ? " " : "";
    const insertedStart = before.length + prefix.length;
    const insertedEnd = insertedStart + addition.length;
    return {
      cursor: insertedEnd,
      insertedEnd,
      insertedStart,
      value: `${before}${prefix}${addition}${suffix}${after}`,
    };
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

  globalThis.__pinarVoice = {
    MAX_VOICE_SECONDS,
    appendVoiceWaveLevel,
    boundedVoiceDuration,
    formatVoiceComment,
    insertVoiceComment,
    preferredVoiceMimeType,
    voiceSignalLevel,
  };
})();
