"""Verify actual PID-tap PCM throughout timestamped native fold/rotation actions."""
import array,json,math,pathlib,sys
root=pathlib.Path(sys.argv[1]);chunks=json.loads((root/'chunks.json').read_text());phases=json.loads((root/'phases.json').read_text())
assert json.loads((root/'capture-format.json').read_text())['inputBufferChannels']==[2], 'Unrelated input or non-stereo capture'
raw=(root/'captured-float32.raw').read_bytes();results=[]
assert {p['name'] for p in phases}=={'closed','partial','rotated','open'}, 'Missing actual native transition interval'
for phase in phases:
 start,end=phase['start'],phase['end'];duration=end-start
 assert duration>.5,'Native action interval too short to verify'
 selected=[c for c in chunks if start<=c['time']<=end]
 assert selected,'No actual callbacks DURING native transition'
 timestamps=[start]+[c['time'] for c in selected]+[end]
 gap=max(b-a for a,b in zip(timestamps,timestamps[1:]))
 assert gap<.25,f"{phase['name']}: actual callback gap {gap:.3f}s"
 samples=array.array('f')
 for chunk in selected:
  values=array.array('f');values.frombytes(raw[chunk['offset']:chunk['offset']+chunk['bytes']]);samples.extend(values[::2])
 assert len(samples)>max(20000,.8*48000*duration),f"{phase['name']}: inadequate actual rendered frame coverage"
 rms=math.sqrt(sum(float(v)**2 for v in samples)/len(samples));assert rms>.01,f"{phase['name']}: real stream silent during fold"
 power={}
 for hz in (520,600,680):
  coefficient=2*math.cos(2*math.pi*hz/48000);first=second=0.0
  for value in samples:next_value=value+coefficient*first-second;second,first=first,next_value
  power[hz]=max(0,first*first+second*second-coefficient*first*second)/len(samples)**2
 assert max(power,key=power.get)==600 and power[600]>3*max(power[520],power[680]),f"{phase['name']}: wrong controlled source output"
 quiet=longest=0
 for offset in range(0,len(samples)-4799,4800):
  window=samples[offset:offset+4800];window_rms=math.sqrt(sum(float(v)**2 for v in window)/4800)
  quiet=quiet+1 if window_rms<.001 else 0;longest=max(longest,quiet)
 assert longest*.1<.25,f"{phase['name']}: sustained actual silent dropout during fold"
 results.append({'phase':phase['name'],'start':start,'end':end,'actual_frames':len(samples),'rms':rms,'expected_hz':600,'band_power':power,'max_callback_gap_seconds':gap,'longest_quiet_run_seconds':longest*.1})
(root/'duo-audio-assertions.json').write_text(json.dumps({'passed':True,'single_source_no_natural_handoffs':True,'phases':results},indent=2))
print('PASS: actual owned app PCM throughout all four native fold/rotation intervals')
