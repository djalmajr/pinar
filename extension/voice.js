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

  globalThis.__pinarVoice = {
    MAX_VOICE_SECONDS,
    boundedVoiceDuration,
    formatVoiceComment,
    preferredVoiceMimeType,
  };
})();
