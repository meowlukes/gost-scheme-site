program GotoDemo;
label again, done;
var a, i, n, s: integer; arr: array[1..10] of integer;
begin
  readln(n);
  again: a := a + 1;
  if a < 10 then goto again;
  for i := 1 to n do
    if arr[i] = 0 then goto done;
  s := 1;
  done: writeln(s);
end.
