import pathlib,time,subprocess,json,os
root=pathlib.Path(os.environ['ARCADIA_DUO_ROOT']);device=os.environ['DUO_DEVICE_ID'];control=os.environ['ARCADIA_DUO_CONTROL'];started=time.time()
output=root/'artifacts'/('short-native-'+str(time.time_ns()));output.mkdir()
def run(*a):return subprocess.check_output(a,text=True).strip()
deadline=time.monotonic()+150;directory=None
while time.monotonic()<deadline:
 try:
  data=run('xcrun','simctl','get_app_container',device,'tokyo.drift.ArcadiaMobileUITests.xctrunner','data')
  candidate=pathlib.Path(data)/'Documents/duo-short-59'
  if (candidate/'request').stat().st_mtime>=started:directory=candidate;break
 except (FileNotFoundError,subprocess.CalledProcessError):pass
 time.sleep(.5)
if directory is None:raise TimeoutError('No fresh actual short-height test request')
try:
 run('open','/Applications/Xcode_27.1.app/Contents/Applications/DeviceHub.app');time.sleep(1)
 run(control,'option','down');time.sleep(1);b=json.loads(run(control,'hinge-bounds'))
 left=b['x']+10;right=b['x']+b['width']-10;y=b['y']+b['height']/2
 run(control,'drag',str(left+(right-left)*float(b['value'])/180),str(y),str(left),str(y));run(control,'option','up')
 orientation=run(os.environ['ARCADIA_DUO_ORIENTATION'],device,'iPhone Duo');(output/'orientation.json').write_text(orientation)
 time.sleep(3)
 run(control,'option','down');time.sleep(.5);pose=json.loads(run(control,'hinge-bounds'));run(control,'option','up')
 if abs(float(pose['value']))>1:raise RuntimeError('Native closed hinge did not commit')
 (output/'pose.json').write_text(json.dumps(pose));(output/'devicehub-ax.txt').write_text(run(control))
 run('/usr/sbin/screencapture','-x',str(output/'devicehub.png'))
 for port in ['primary','primary-1']:run('xcrun','simctl','io',device,'screenshot','--display='+port,str(output/(port+'.png')))
 (directory/'complete').write_text('Native closed hinge and Device > Orientation > Landscape Right applied')
finally:run(control,'option','up')
print(output)
