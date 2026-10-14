import fcntl,json,pathlib,subprocess,time,os,shutil
root=pathlib.Path(os.environ['ARCADIA_DUO_ROOT']);base=root/'audio';base.mkdir(exist_ok=True)
lock=open(base/'owner.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
out=base/'rendered-output';out.mkdir(exist_ok=False);started=time.time();children=[]
helper=os.environ['ARCADIA_AUDIO_CAPTURE_HELPER']
def command(*a):return subprocess.check_output(a,text=True).strip()
try:
 for name,flags in [('direct',['--unmuted']),('global',['--paused-output'])]:
  directory=out/name;directory.mkdir();log=open(directory/'capture.log','w')
  children.append((directory,subprocess.Popen([helper,str(directory)]+flags,stdout=log,stderr=subprocess.STDOUT),log))
 deadline=time.monotonic()+300;protocol=None
 while time.monotonic()<deadline:
  if (out/'driver.finished').exists():raise RuntimeError('Public UI ended before target')
  try:
   container=command('xcrun','simctl','get_app_container',os.environ['DUO_DEVICE_ID'],'tokyo.drift.ArcadiaMobileUITests.xctrunner','data')
   candidate=pathlib.Path(container)/'Documents/duo-real-59'
   if (candidate/'target-request').stat().st_mtime>=started:protocol=candidate;break
  except (FileNotFoundError,subprocess.CalledProcessError):pass
  time.sleep(.5)
 if protocol is None:raise TimeoutError('No public stationary target')
 rows=[r for r in command('ps','-axo','pid,command').splitlines() if '/Arcadia.app/Arcadia' in r]
 if len(rows)!=1:raise RuntimeError('Expected one actual Arcadia process')
 pid=int(rows[0].strip().split()[0]);(out/'attribution.txt').write_text(rows[0])
 for directory,child,log in children:(directory/'target.json').write_text(json.dumps({'pid':pid}))
 print('dual target',pid,flush=True);deadline=time.monotonic()+30
 while not all((directory/'capture-ready').exists() for directory,_,_ in children):
  if time.monotonic()>deadline or any(child.poll() is not None for _,child,_ in children):raise RuntimeError('Dual capture not ready')
  time.sleep(.2)
 (protocol/'capture-ready').write_text('Two actual helpers ready');print('dual ready',flush=True)
 deadline=time.monotonic()+300
 while not (protocol/'done').exists():
  if (out/'driver.finished').exists() or time.monotonic()>deadline:raise RuntimeError('Public stationary journey did not complete')
  time.sleep(.2)
 for directory,_,_ in children:
  (directory/'protocol-completed').touch()
finally:
 for directory,child,log in children:
  (directory/'done').touch()
  try:child.wait(timeout=5)
  except subprocess.TimeoutExpired:
   child.terminate()
   try:child.wait(timeout=2)
   except subprocess.TimeoutExpired:child.kill();child.wait()
  log.close()
 print('Both owned capture children reaped',flush=True)
