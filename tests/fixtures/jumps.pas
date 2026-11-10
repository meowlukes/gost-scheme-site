program Jumps;
var i, j, n, s: integer; a: array[1..100] of integer;

procedure Report(x: integer);
begin
  writeln(x);
end;

function Find(x: integer): integer;
var i: integer;
begin
  Find := 0;
  for i := 1 to n do
  begin
    if a[i] = x then
    begin
      Find := i;
      exit;
    end;
  end;
end;

begin
  readln(n);
  if n <= 0 then
  begin
    writeln('Ошибка: неверное n');
    exit;
  end;
  for i := 1 to n do read(a[i]);
  s := 0; i := 1;
  while i <= n do
  begin
    if a[i] < 0 then break;
    if a[i] = 0 then begin i := i + 1; continue; end;
    s := s + a[i];
    i := i + 1;
  end;
  for i := 1 to n do
  begin
    if odd(a[i]) then continue;
    for j := i to n do
    begin
      if a[j] > 100 then break;
      s := s + a[j] * a[i];
    end;
  end;
  repeat
    s := s div 2;
    if s = 7 then break;
  until s < 10;
  Report(s);
  j := Find(s);
  if j > 0 then Report(j) else writeln('нет');
end.
